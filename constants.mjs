import { prepareStructs, Types } from "./serialise.mjs";

export const Signatures = {
    centralDirectoryHeader: 0x02014b50,
    localFileHeader: 0x04034b50,
    endOfCentralDirectory: 0x06054b50,
    zip64EndOfCentralDirectory: 0x06064b50,
    zip64EndOfCentralDirectoryLocator: 0x07064b50,
    dataDescriptor: 0x08074b50
};

export const CompressionMethods = {
    store: 0, // no compression
    deflate: 8
};

export const Flags = {
    Descriptor: 1 << 3,
    UTF8: 1 << 11
};

const {u16, u32, u64} = Types;
export const Structs = prepareStructs({
    zip64EndOfCentralDirectoryRecord: [
        ["signature", u32, Signatures.zip64EndOfCentralDirectory],
        ["sizeOfCentralDirectoryRecord", u64],
        ["versionMadeBy", u16, 45],
        ["versionNeededToExtract", u16, 45],
        ["diskNumber", u32, 0],
        ["diskNumberWithinCentralDirectory", u32, 0],
        ["numEntries", u64],
        ["numEntries", u64],
        ["centralDirectorySize", u64],
        ["centralDirectoryStart", u64]
    ],
    endOfCentralDirectoryRecord: [
        ["signature", u32, Signatures.endOfCentralDirectory],
        ["diskNumber", u16, 0],
        ["diskNumberWithinCentralDirectory", u16, 0],
        ["numEntries", u16],
        ["numEntries", u16],
        ["centralDirectorySize", u32],
        ["centralDirectoryStart", u32],
        ["zipFileCommentLength", u16],
    ],
    zip64EndOfCentralDirectoryLocator: [
        ["signature", u32, Signatures.zip64EndOfCentralDirectoryLocator],
        ["numDisksBeforeStart", u32, 0],
        ["relativeOffset", u64],
        ["totalNumberOfDisks", u32, 1]
    ],
    zip64DataDescriptor: [
        ["signature", u32, Signatures.dataDescriptor],
        ["crc32", u32],
        ["compressedSize", u64],
        ["uncompressedSize", u64]
    ],
});