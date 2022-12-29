const crcTable = (() => {
    const table = new Array(256);
    
    for (let i = 0; i < 256; ++i) {
        let crc = i;

        for (let j = 0; j < 8; ++j) {
            if (crc & 1) {
                crc = (0xedb88320 ^ (crc >>> 1)) >>> 0;
            }
            else {
                crc >>>= 1;
            }
        }

        table[i] = crc;
    }

    return table;
})(); 

export function updateCRC(chunk, crc) {
    for (const byte of chunk) {
        const lookupIndex = (crc ^ byte) & 0xff;
        crc = (crc >>> 8) ^ crcTable[lookupIndex];
    }

    return crc;
}

export async function crcFile(fd) {
    const readStream = fd.createReadStream({start: 0, autoClose: false});
    let crc = 0xffffffff;

    return new Promise((resolve, reject) => {
        readStream.on("data", d => {
            crc = updateCRC(d, crc);
        });

        readStream.on("end", () => {
            resolve((crc ^ 0xffffffff) >>> 0);
        });

        readStream.on("error", reject);
    });
}