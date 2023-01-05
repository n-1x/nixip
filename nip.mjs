// Author: Nicholas Dean

/* Structure of zips generated by this program:
      [local file header 1]
      [file data 1]
      [zip64 data descriptor 1]
      ...
      [local file header n]
      [file data n]
      [zip64 data descriptor n]
      [central directory header 1]
      [optional zip64 extra field 1]
      ...
      [central directory header n]
      [optional zip64 extra field n]
      [zip64 end of central directory record]
      [zip64 end of central directory locator]
      [end of central directory record]
*/
import fs from "fs";
import { Transform } from "stream";
import { finished } from "stream/promises";
import { createDeflateRaw } from "zlib";
import { Signatures, CompressionMethods, Flags, Structs } from "./constants.mjs";
import { updateCRC } from "./crc.mjs";
import { createBufferForStruct } from "./serialise.mjs";

export function getFileNameFromPath(filePath) {
    let fileName = "";

    for (const char of filePath) {
        if (char === "/" || char === "\\") {
            fileName = "";
        }
        else {
            fileName += char;
        }
    };

    return fileName;
}

function createFileInfoObject(fileName, localHeaderOffset, fileComment = "") {
    let shouldCompress = true;
    const version = 45; // minimum for Zip64

    return {
        versionNeededToExtract: version, 
        generalPurposeBitFlag: Flags.Descriptor | Flags.UTF8,
        compressionMethod: shouldCompress ? CompressionMethods.deflate : CompressionMethods.store,
        lastModFileTime: 0,
        lastModFileDate: 0,
        crc32: 0xffffffff,
        compressedSize: 0,
        uncompressedSize: 0,
        fileName,
        versionMadeby: version,
        fileComment,
        diskNumberStart: 0,
        internalFileAttributes: 0,
        externalFileAttributes: 0,
        relativeOffsetOfLocalHeader: localHeaderOffset,
    };
}

/* 4.5.3 -Zip64 Extended Information Extra Field (0x0001):
      The following is the layout of the zip64 extended 
      information "extra" block. If one of the size or
      offset fields in the Local or Central directory
      record is too small to hold the required data,
      a Zip64 extended information record is created.
      The order of the fields in the zip64 extended 
      information record is fixed, but the fields MUST
      only appear if the corresponding Local or Central
      directory record field is set to 0xFFFF or 0xFFFFFFFF.

      Note: all fields stored in Intel low-byte/high-byte order.

        Value      Size       Description
        -----      ----       -----------
(ZIP64) 0x0001     2 bytes    Tag for this "extra" block type
        Size       2 bytes    Size of this "extra" block
        Original 
        Size       8 bytes    Original uncompressed file size
        Compressed
        Size       8 bytes    Size of compressed data
        Relative Header
        Offset     8 bytes    Offset of local header record
        Disk Start
        Number     4 bytes    Number of the disk on which
                              this file starts 

      This entry in the Local header MUST include BOTH original
      and compressed file size fields. If encrypting the 
      central directory and bit 13 of the general purpose bit
      flag is set indicating masking, the value stored in the
      Local Header for the original file size will be zero.
*/
function createZIP64ExtraField(zip64Fields, isCentralDirectory) {
    // Only works because all optional fields are currently 8 bytes
    const optionalFieldsLength = Object.keys(zip64Fields).length * 8;
    const zip64Header = Buffer.alloc(4 + optionalFieldsLength);

    let bytesWritten = 0;
    bytesWritten = zip64Header.writeUInt16LE(0x0001, bytesWritten);
    bytesWritten = zip64Header.writeUInt16LE(optionalFieldsLength, bytesWritten);

    if (zip64Fields.uncompressedSize !== undefined) {
        const val = BigInt(isCentralDirectory ? zip64Fields.uncompressedSize : 0);
        bytesWritten = zip64Header.writeBigUInt64LE(val, bytesWritten);
    }

    if (zip64Fields.compressedSize !== undefined) {
        const val = BigInt(isCentralDirectory ? zip64Fields.compressedSize : 0);
        bytesWritten = zip64Header.writeBigUInt64LE(val, bytesWritten);
    }

    if (zip64Fields.relativeOffsetOfLocalHeader !== undefined) {
        bytesWritten = zip64Header.writeBigUInt64LE(BigInt(zip64Fields.relativeOffsetOfLocalHeader), bytesWritten);
    }

    return zip64Header;
}

/* Structure of file header (* only present in central directory header):
        signature                       4 bytes 
        version made by                 2 bytes *
        version needed to extract       2 bytes
        general purpose bit flag        2 bytes
        compression method              2 bytes
        last mod file time              2 bytes
        last mod file date              2 bytes
        crc-32                          4 bytes
        compressed size                 4 bytes
        uncompressed size               4 bytes
        file name length                2 bytes
        extra field length              2 bytes
        file comment length             2 bytes *
        disk number start               2 bytes *
        internal file attributes        2 bytes *
        external file attributes        4 bytes *
        relative offset of local header 4 bytes *

        file name (variable size)
        extra field (variable size)
        file comment (variable size)            *
 */
function createFileHeader(originalFileInfo, isCentralDirectory = false) {
    const fileInfo = { ...originalFileInfo, extraFieldLength: 0 };
    const fileNameBuffer = Buffer.from(fileInfo.fileName);
    let headerSize = (isCentralDirectory ? 46 : 30) + fileNameBuffer.length;
    let zip64Header = null;
    const zip64Fields = {};

    if (isCentralDirectory) {
        if (fileInfo.uncompressedSize >= 0xffffffff || fileInfo.compressedSize >= 0xffffffff) {
            zip64Fields.compressedSize = fileInfo.compressedSize,
            zip64Fields.uncompressedSize = fileInfo.uncompressedSize
            fileInfo.uncompressedSize = 0xffffffff;
            fileInfo.compressedSize = 0xffffffff;
        }

        if (fileInfo.relativeOffsetOfLocalHeader > 0xffffffff) {
            zip64Fields.relativeOffsetOfLocalHeader = fileInfo.relativeOffsetOfLocalHeader;
            fileInfo.relativeOffsetOfLocalHeader = 0xffffffff;
        }

        console.log("Moving these fields to ZIP64 extra field: ", Object.keys(zip64Fields));
    }

    if (Object.keys(zip64Fields).length > 0) {
        zip64Header = createZIP64ExtraField(zip64Fields, isCentralDirectory);
        fileInfo.extraFieldLength = zip64Header.length;
        headerSize += fileInfo.extraFieldLength;
    }

    let fileCommentBuffer = null;
    let fileCommentLength = 0;
    if (isCentralDirectory) {
        fileCommentBuffer = Buffer.from(fileInfo.fileComment); //TODO: Just create the buffer at info time
        fileCommentLength = fileCommentBuffer.length;
        headerSize += fileCommentLength;
    }

    const header = Buffer.alloc(headerSize);
    let bytesWritten = 0;

    const signature = isCentralDirectory ? Signatures.centralDirectoryHeader : Signatures.localFileHeader;
    bytesWritten = header.writeUInt32LE(signature, bytesWritten);

    if (isCentralDirectory) {
        bytesWritten = header.writeUInt16LE(fileInfo.versionMadeby, bytesWritten);
    }

    bytesWritten = header.writeUInt16LE(fileInfo.versionNeededToExtract, bytesWritten);
    bytesWritten = header.writeUInt16LE(fileInfo.generalPurposeBitFlag, bytesWritten);
    bytesWritten = header.writeUInt16LE(fileInfo.compressionMethod, bytesWritten);
    bytesWritten = header.writeUInt16LE(fileInfo.lastModFileTime, bytesWritten);
    bytesWritten = header.writeUInt16LE(fileInfo.lastModFileDate, bytesWritten);

    // for the following 3 fields, if they are local records, the value is not yet known
    // and will be calculated while writing the file data and placed in a descriptor
    // but for central directory records, they are known and should be includd
    bytesWritten = header.writeUInt32LE(isCentralDirectory ? fileInfo.crc32 : 0, bytesWritten);
    bytesWritten = header.writeUInt32LE(isCentralDirectory ? fileInfo.compressedSize : 0, bytesWritten);
    bytesWritten = header.writeUInt32LE(isCentralDirectory ? fileInfo.uncompressedSize : 0, bytesWritten);
    bytesWritten = header.writeUInt16LE(fileNameBuffer.length, bytesWritten);
    bytesWritten = header.writeUInt16LE(fileInfo.extraFieldLength, bytesWritten);

    if (isCentralDirectory) {
        bytesWritten = header.writeUInt16LE(fileCommentLength, bytesWritten);
        bytesWritten = header.writeUint16LE(0, bytesWritten); // disk number start
        bytesWritten = header.writeUInt16LE(fileInfo.internalFileAttributes, bytesWritten);
        bytesWritten = header.writeUInt32LE(fileInfo.externalFileAttributes, bytesWritten);
        bytesWritten = header.writeUInt32LE(fileInfo.relativeOffsetOfLocalHeader, bytesWritten);
    }

    bytesWritten += fileNameBuffer.copy(header, bytesWritten);

    if (fileInfo.extraFieldLength > 0) {
        bytesWritten += zip64Header.copy(header, bytesWritten);
        console.log("Wrote", zip64Header.length, "byte extra field");
    }

    if (isCentralDirectory && fileCommentLength > 0) {
        console.log("Writing file comment, length", fileCommentLength)
        bytesWritten += fileCommentBuffer.copy(header, bytesWritten);
    }

    return header;
}

/* 4.3.14  Zip64 end of central directory record
        zip64 end of central dir 
        signature                       4 bytes  (0x06064b50)
        size of zip64 end of central
        directory record                8 bytes
        version made by                 2 bytes
        version needed to extract       2 bytes
        number of this disk             4 bytes
        number of the disk with the 
        start of the central directory  4 bytes
        total number of entries in the
        central directory on this disk  8 bytes
        total number of entries in the
        central directory               8 bytes
        size of the central directory   8 bytes
        offset of start of central
        directory with respect to
        the starting disk number        8 bytes
        zip64 extensible data sector    (variable size)
 */
function createZIP64EndOfCentralDirectoryRecord(centralDirectoryStart, centralDirectorySize, numEntries) {
    const sizeOfFixedFields = 56;
    const sizeOfCentralDirectoryRecord = sizeOfFixedFields - 12; // currently no variable data here

    const [record] = createBufferForStruct(Structs.zip64EndOfCentralDirectoryRecord, {
        sizeOfCentralDirectoryRecord: BigInt(sizeOfCentralDirectoryRecord),
        numEntries: BigInt(numEntries),
        centralDirectorySize: BigInt(centralDirectorySize),
        centralDirectoryStart: BigInt(centralDirectoryStart)
    });

    return record;
}

/* 4.3.16  End of central directory record:
      end of central dir signature    4 bytes  (0x06054b50)
      number of this disk             2 bytes
      number of the disk with the
      start of the central directory  2 bytes
      total number of entries in the
      central directory on this disk  2 bytes
      total number of entries in
      the central directory           2 bytes
      size of the central directory   4 bytes
      offset of start of central
      directory with respect to
      the starting disk number        4 bytes
      .ZIP file comment length        2 bytes
      .ZIP file comment       (variable size)
 */
function createEndOfCentralDirectoryRecord(centralDirectoryStart, centralDirectorySize, numEntries, zipFileComment = "") {
    if (numEntries >= 0xffff) {
        numEntries = 0xffff;
    }

    if (centralDirectorySize >= 0xffffffff) {
        centralDirectorySize = 0xffffffff;
    }

    if (centralDirectoryStart >= 0xffffffff) {
        centralDirectoryStart = 0xffffffff;
    }

    const [record, bytesWritten] = createBufferForStruct(Structs.endOfCentralDirectoryRecord, {
        numEntries,
        centralDirectorySize,
        centralDirectoryStart,
        zipFileCommentLength: zipFileComment.length
    });
    record.write(zipFileComment, bytesWritten);

    return record;
}

function createZIP64EndOfCentralDirectoryLocator(relativeOffset) {
    const [record] = createBufferForStruct(Structs.zip64EndOfCentralDirectoryLocator, {
        relativeOffset: BigInt(relativeOffset)
    });
    
    return record;
}

function createZIP64DataDescriptor(fileInfo) {
    const [record] = createBufferForStruct(Structs.zip64DataDescriptor, {
        ...fileInfo,
        compressedSize: BigInt(fileInfo.compressedSize),
        uncompressedSize: BigInt(fileInfo.uncompressedSize)
    });
    
    return record;
}

export function startZip(outputFilePath) {
    return {
        writeStream: fs.createWriteStream(outputFilePath),
        currentPosInWriteStream: 0,
        fileInfoList: []
    }
}

export async function addFileToZip(state, fileName, readStream) {
    const deflate = createDeflateRaw();
    const fileInfo = createFileInfoObject(fileName, state.currentPosInWriteStream);
    state.fileInfoList.push(fileInfo);

    const localFileHeader = createFileHeader(fileInfo, false);
    state.writeStream.write(localFileHeader);
    state.currentPosInWriteStream += localFileHeader.length;
    console.log("Wrote local file header for", fileInfo.fileName);

    const t1 = new Transform({
        transform(chunk, encoding, callback) {
            fileInfo.uncompressedSize += chunk.length;
            fileInfo.crc32 = updateCRC(chunk, fileInfo.crc32)
            callback(null, chunk);
        }
    });

    const t2 = new Transform({
        transform(chunk, encoding, callback) {
            fileInfo.compressedSize += chunk.length;
            state.currentPosInWriteStream += chunk.length;
            callback(null, chunk);
        }
    });
    
    readStream.pipe(t1).pipe(deflate).pipe(t2).pipe(state.writeStream, {end: false});
    await finished(t2);

    fileInfo.crc32 = (fileInfo.crc32 ^ 0xffffffff) >>> 0;
    console.log(`Wrote file data. C: ${fileInfo.compressedSize} U: ${fileInfo.uncompressedSize}`);

    const dataDescriptor = createZIP64DataDescriptor(fileInfo);
    state.writeStream.write(dataDescriptor);
    state.currentPosInWriteStream += dataDescriptor.length;
    console.log(`Wrote data descriptor`);
}

export async function endZip(state) {
    const centralDirectoryStartPos = state.currentPosInWriteStream;
    for (const fileInfo of state.fileInfoList) {
        const centralDirectoryRecord = createFileHeader(fileInfo, true);
        state.writeStream.write(centralDirectoryRecord);
        state.currentPosInWriteStream += centralDirectoryRecord.length;
        console.log("Wrote central directory file header for", fileInfo.fileName.toString(), centralDirectoryRecord.length, "bytes");
    }
    const centralDirectorySize = state.currentPosInWriteStream - centralDirectoryStartPos;

    const zip64EndRecord = createZIP64EndOfCentralDirectoryRecord(centralDirectoryStartPos, centralDirectorySize, state.fileInfoList.length);
    const endRecordOffset = state.currentPosInWriteStream;
    state.currentPosInWriteStream += state.writeStream.write(zip64EndRecord);
    console.log("Wrote zip64 end of central directory header");

    const zip64EndLocator = createZIP64EndOfCentralDirectoryLocator(endRecordOffset);
    state.currentPosInWriteStream += state.writeStream.write(zip64EndLocator);
    console.log("Wrote zip64 end of central directory locator");

    const endRecord = createEndOfCentralDirectoryRecord(centralDirectoryStartPos, centralDirectorySize, state.fileInfoList.length);
    state.currentPosInWriteStream += state.writeStream.write(endRecord);
    console.log("Wrote end of central directory record");
}

export async function createZipFromFileList(filePathList, zipFilePath) {
    const zipState = startZip(zipFilePath);

    for (const filePath of filePathList) {
        const readStream = fs.createReadStream(filePath);
        const fileName = await getFileNameFromPath(filePath);
        await addFileToZip(zipState, fileName, readStream);
    }

    await endZip(zipState);
}

createZipFromFileList(["./compressable.txt", "./test1.txt", "./test2.txt", "./유니코드 테스트.txt"], "./nick.zip");