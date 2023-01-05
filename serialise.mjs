export const Types = {
    u16: "UInt16LE",
    u32: "UInt32LE",
    u64: "BigUInt64LE",
};

const TypeSizes = {
    [Types.u16]: 2,
    [Types.u32]: 4,
    [Types.u64]: 8
};

export function prepareStructs(structsObj) {
    // add byteSize information to structs
    for (const [structName, struct] of Object.entries(structsObj)) {
        let size = 0;

        for (const [name, type] of struct) {
            size += TypeSizes[type];
        }

        struct.byteSize = size;
    }

    return structsObj;
}

export function createBufferForStruct(struct, data, extraSpaceAfter = 0, extraSpaceBefore = 0) {
    const buffer = Buffer.alloc(extraSpaceBefore + struct.byteSize + extraSpaceAfter);
    let bytePos = extraSpaceBefore;

    for (const [name, type, literal] of struct) {
        const writeFunc = "write" + type;
        const value = data[name] ?? literal;

        bytePos = buffer[writeFunc](value, bytePos);
    }

    return [buffer, bytePos];
}