// Author: Nicholas Dean

/* 4.3.6 Overall .ZIP file format:
      [local file header 1]
      [file data 1]
      . 
      .
      .
      [local file header n]
      [file data n]
      [archive decryption header] 
      [archive extra data record] 
      [central directory header 1]
      .
      .
      .
      [central directory header n]
      [zip64 end of central directory record]
      [zip64 end of central directory locator] 
      [end of central directory record]
*/

import fsp from "fs/promises"
import streamPromises from 'node:stream/promises';
import { crcFile } from "./crc.mjs";
import { Signatures, CompressionMethods } from "./constants.mjs";

export function getFileName(filePath) {
    const regex = RegExp("([^\/]*?)$");
    const normalisedPath = filePath.replaceAll("\\", "/");
    const result = regex.exec(normalisedPath);

    if (result[1]) {
        return result[1];
    }

    return null;
}

function getBitFlags() {
    let flags = 1 << 11; // language encoding flag (enables utf-8)
    return flags;
}

async function getInfoForFile(fd, filePath, fileComment = "") {
    const stat = await fd.stat();
    const fileName = getFileName(filePath);
    const fileNameBuffer = Buffer.from(fileName, "utf8");
    const fileCommentBuffer = Buffer.from(fileComment);
    const crc32 = await crcFile(fd);

    return {
        versionNeededToExtract: 10, // 1.0
        generalPurposeBitFlag: getBitFlags(),
        compressionMethod: CompressionMethods.store,
        lastModFileTime: 0,
        lastModFileDate: 0,
        crc32,
        compressedSize: stat.size,
        uncompressedSize: stat.size,
        fileName,
        fileNameLength: fileNameBuffer.length,
        extraFieldLength: 0,
        versionMadeby: 0,
        fileComment,
        fileCommentLength: fileCommentBuffer.length,
        diskNumberStart: 0,
        internalFileAttributes: 0,
        externalFileAttributes: 0,
        relativeOffsetOfLocalHeader: 0,
    };
}

/* 4.3.7  Local file header:
      local file header signature     4 bytes  (0x04034b50)
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

      file name (variable size)
      extra field (variable size)
 */
function createLocalFileHeader(fileInfo) {
    const localHeader = Buffer.alloc(30 + fileInfo.fileNameLength + fileInfo.extraFieldLength);
    
    let bytesWritten = 0;
    bytesWritten = localHeader.writeUInt32LE(Signatures.localFileHeader, bytesWritten);
    bytesWritten = localHeader.writeUInt16LE(fileInfo.versionNeededToExtract, bytesWritten);
    bytesWritten = localHeader.writeUInt16LE(fileInfo.generalPurposeBitFlag, bytesWritten);
    bytesWritten = localHeader.writeUInt16LE(fileInfo.compressionMethod, bytesWritten);
    bytesWritten = localHeader.writeUInt16LE(fileInfo.lastModFileTime, bytesWritten);
    bytesWritten = localHeader.writeUInt16LE(fileInfo.lastModFileDate, bytesWritten);
    bytesWritten = localHeader.writeUInt32LE(fileInfo.crc32, bytesWritten);
    bytesWritten = localHeader.writeUInt32LE(fileInfo.compressedSize, bytesWritten);
    bytesWritten = localHeader.writeUInt32LE(fileInfo.uncompressedSize, bytesWritten);
    bytesWritten = localHeader.writeUInt16LE(fileInfo.fileNameLength, bytesWritten);
    bytesWritten = localHeader.writeUInt16LE(fileInfo.extraFieldLength, bytesWritten);
    bytesWritten += localHeader.write(fileInfo.fileName, bytesWritten);
    
    return localHeader;
}

/* Central Directory File header:
        central file header signature   4 bytes  (0x02014b50)
        version made by                 2 bytes
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
        file comment length             2 bytes
        disk number start               2 bytes
        internal file attributes        2 bytes
        external file attributes        4 bytes
        relative offset of local header 4 bytes

        file name (variable size)
        extra field (variable size)
        file comment (variable size) 
 */
function createCentralDirectoryHeader(fileInfo) {
    const centralDirectoryHeader = Buffer.alloc(46 + fileInfo.fileNameLength 
        + fileInfo.extraFieldLength + fileInfo.fileCommentLength);

    let bytesWritten = 0;
    bytesWritten = centralDirectoryHeader.writeUInt32LE(Signatures.centralDirectoryHeader, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt16LE(fileInfo.versionMadeby, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt16LE(fileInfo.versionNeededToExtract, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt16LE(fileInfo.generalPurposeBitFlag, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt16LE(fileInfo.compressionMethod, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt16LE(fileInfo.lastModFileTime, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt16LE(fileInfo.lastModFileDate, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt32LE(fileInfo.crc32, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt32LE(fileInfo.compressedSize, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt32LE(fileInfo.uncompressedSize, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt16LE(fileInfo.fileNameLength, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt16LE(fileInfo.extraFieldLength, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt16LE(fileInfo.fileCommentLength, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt16LE(fileInfo.diskNumberStart, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt16LE(fileInfo.internalFileAttributes, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt32LE(fileInfo.externalFileAttributes, bytesWritten);
    bytesWritten = centralDirectoryHeader.writeUInt32LE(fileInfo.relativeOffsetOfLocalHeader, bytesWritten);

    bytesWritten += centralDirectoryHeader.write(fileInfo.fileName, bytesWritten);
    bytesWritten += centralDirectoryHeader.write(fileInfo.fileComment, bytesWritten);

    return centralDirectoryHeader;
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
    const centralDirectoryRecord = Buffer.alloc(22 + zipFileComment.length);
    const diskNumber = 0;
    const diskNumberWithinCentralDirectory = 0;

    let bytesWritten = 0;
    bytesWritten = centralDirectoryRecord.writeUInt32LE(Signatures.endOfCentralDirectory, bytesWritten);
    bytesWritten = centralDirectoryRecord.writeUInt16LE(diskNumber, bytesWritten);
    bytesWritten = centralDirectoryRecord.writeUInt16LE(diskNumberWithinCentralDirectory, bytesWritten);
    bytesWritten = centralDirectoryRecord.writeUInt16LE(numEntries, bytesWritten);
    bytesWritten = centralDirectoryRecord.writeUInt16LE(numEntries, bytesWritten);
    bytesWritten = centralDirectoryRecord.writeUInt32LE(centralDirectorySize, bytesWritten);
    bytesWritten = centralDirectoryRecord.writeUInt32LE(centralDirectoryStart, bytesWritten);
    bytesWritten = centralDirectoryRecord.writeUInt16LE(zipFileComment.length, bytesWritten);
    bytesWritten += centralDirectoryRecord.write(zipFileComment, bytesWritten);
 
    return centralDirectoryRecord;
}

export async function createZip(filePathList, zipFilePath) {
    const zipFD = await fsp.open(zipFilePath, "w");
    const writeStream = zipFD.createWriteStream(zipFilePath);

    const fileInfos = [];
    let currentPosInWriteStream = 0;

    for (const filePath of filePathList) {
        const fd = await fsp.open(filePath);
        
        const fileInfo = await getInfoForFile(fd, filePath);
        console.log(`${fileInfo.fileName} hash: ${fileInfo.crc32.toString(16)}`)
        fileInfo.relativeOffsetOfLocalHeader = currentPosInWriteStream;
        fileInfos.push(fileInfo);

        const lfh = createLocalFileHeader(fileInfo);
        writeStream.write(lfh);
        currentPosInWriteStream += lfh.length;
        console.log("Wrote local file header for", fileInfo.fileName.toString());

        const readStream = fd.createReadStream();
        readStream.pipe(writeStream, {end: false});
        await streamPromises.finished(readStream);
        currentPosInWriteStream += fileInfo.compressedSize;
        console.log(`Wrote ${fileInfo.compressedSize} bytes of file data`);

        fd.close();
    }

    const centralDirectoryStartPos = currentPosInWriteStream;

    for (const fileInfo of fileInfos) {
        const centralDirectoryRecord = createCentralDirectoryHeader(fileInfo);
        writeStream.write(centralDirectoryRecord);
        console.log("Wrote central directory file header for", fileInfo.fileName.toString(), centralDirectoryRecord.length, "bytes");
        console.log("Relative offset for this file ")
        currentPosInWriteStream += centralDirectoryRecord.length;
    }

    const centralDirectorySize = currentPosInWriteStream - centralDirectoryStartPos;
    const endRecord = createEndOfCentralDirectoryRecord(centralDirectoryStartPos, centralDirectorySize, fileInfos.length);
    writeStream.write(endRecord);
    console.log("Wrote end of central directory file header");

    writeStream.close();
}

createZip(["./test1.txt", "./test2.txt", "유니코드 테스트.txt"], "./nick.zip");