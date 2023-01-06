import fsp from "fs/promises";
import { Signatures, Definitions }from "./constants.mjs"
import { Struct } from "./serialise.mjs";

const searchSize = 2048;

async function findZip64Locator(fd) {
    const signatureBuffer = Buffer.alloc(4);
    signatureBuffer.writeUint32LE(Signatures.zip64EndOfCentralDirectoryLocator);
    const buffer = Buffer.alloc(searchSize);
    const stat = await fd.stat({bigint: true});
    let found = false;
    let signatureOffset = null;
    let locator = null;
    let negativeOffset = 0;
    let lastBytesRead = 0;

    while (!found) {
        const position = Math.max(0, Number(stat.size) - searchSize - negativeOffset);
        const info = await fd.read(buffer, 0, searchSize, position);

        lastBytesRead = info.bytesRead;
        const bufferOffset = buffer.indexOf(signatureBuffer);
        
        if (bufferOffset === -1) {
            negativeOffset += (searchSize - signatureBuffer.length);
        }
        else {
            console.log("Found locator")
            found = true;
            signatureOffset = position + bufferOffset;
        }
    }

    if (found) {
        const sizeOfCentralDirectoryLocator = 20;
        const bytesAfterSignature = lastBytesRead - signatureOffset;

        if (bytesAfterSignature < sizeOfCentralDirectoryLocator) {
            // read sizeOfCentralDirectoryLocator bytes from signatureOffset
        }
        else {
            console.log("Parsing locator")
            locator = await Struct.FromBuffer(
                Definitions.zip64EndOfCentralDirectoryLocator, 
                buffer, 
                signatureOffset
            );
            console.log("locator parsed, offset", locator.relativeOffset);
        }
    }

    return locator;
}

function readZip64CentralDirectory(fd, endRecord) {
    const {centralDirectorySize, centralDirectoryStart} = endRecord;
    
    const fileList = [];
}

async function readZip(filePath) {
    const fd = await fsp.open(filePath, "r");
    console.log("Searching for locator");
    const locator = await findZip64Locator(fd);
    
    console.log("Found offset to be", locator.relativeOffset);
    
    const zip64EndOfCIR = new Struct(
        Definitions.zip64EndOfCentralDirectoryRecord
    );
    const size = zip64EndOfCIR.size;
    let {buffer: endOfCIRBuffer, bytesRead} = await fd.read(Buffer.alloc(size), 0, size, locator.relativeOffset);
    
    console.log("Reading end of CIR")
    await zip64EndOfCIR.readFromBuffer(endOfCIRBuffer);
    console.log("Found end of central directory");
    readZip64CentralDirectory(fd, zip64EndOfCIR);
}

readZip("./nick.zip");