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