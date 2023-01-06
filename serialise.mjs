export const Types = {
    u16: "UInt16LE",
    u32: "UInt32LE",
    u64: "BigUInt64LE",
};

export const Defaults = {
    [Types.u16]: 0,
    [Types.u32]: 0,
    [Types.u64]: 0n,
};

const TypeSizes = {
    [Types.u16]: 2,
    [Types.u32]: 4,
    [Types.u64]: 8
};

export class Struct {
    constructor(definition = [], data = {}) {
        this.entryOrder = [];
        this.entries = {};

        definition.forEach(entry => {{
            const [name, type, literal] = entry;
            const valueToUse = data[name] ?? literal;
            this.addEntry(name, type, valueToUse);
        }});
    }

    static async FromBuffer(definition, buffer, offset = 0) {
        const struct = new Struct(definition);
        await struct.readFromBuffer(buffer, offset);
        return struct;
    }

    addEntry(name, type, value) {
        if (value === null || value === undefined) {
            value = Defaults[type];
        }

        this.entryOrder.push(name);
        this.entries[name] = {type, value};

        Object.defineProperty(this, name, {
            get() {
                return this.entries[name].value;
            },

            set(value) {
                this.entries[name].value = value;
            }
        })
    }

    writeToBuffer(buf, offset = 0) {
        let bytePos = offset;

        for (const entryName of this.entryOrder) {
            let {type, value} = this.entries[entryName];
            const writeFunc = "write" + type;

            if (type === Types.u64) {
                value = BigInt(value);
            }

            bytePos = buf[writeFunc](value, bytePos);
        }
        
        buf.bytesSerialised = bytePos - offset;
        return buf;
    }

    createBuffer(extraSpace = 0) {
        const size = this.size;
        const buf = Buffer.alloc(size + extraSpace);
        return this.writeToBuffer(buf);
    }

    async readFromBuffer(buffer, offset = 0) {
        let bytePos = offset;

        for (const [name, {type}] of Object.entries(this.entries)) {
            const readFunc = "read" + type;
            console.log("reading", name)
            const readValue = await buffer[readFunc](bytePos);
            this.entries[name].value = readValue
            bytePos += TypeSizes[type];
        }

        return bytePos - offset;
    }

    editEntry(entryName, newValue, newType = null) {
        if (this.entries[entryName]) {
            if (newValue !== null) {
                this.entries[entryName].value = newValue;
            }

            if (newType !== null) {
                this.entries[entryName].type = newType;
            }
        }
    }

    sizeFrom(entryName, inclusive = false) {
        let index = this.entryOrder.indexOf(entryName);

        if (index === -1) {
            return null;
        }

        if (!inclusive) {
            index += 1;
        }

        let size = 0;
        for (let i = index; i < this.entryOrder.length; ++i) {
            const entryName = this.entryOrder[i];
            size += TypeSizes[this.entries[entryName].type];
        }
        
        return size;
    }

    sizeUntil(entryName, inclusive = false) {
        let index = this.entryOrder.indexOf(entryName);

        if (index === -1) {
            return null;
        }

        if (!inclusive) {
            index -= 1; 
        }

        let size = 0;
        for (let i = 0; i <= index; ++i) {
            const entryName = this.entryOrder[i];
            size += TypeSizes[this.entries[entryName].type];
        }

        return size;
    }

    get size() {
        let size = 0;

        for (const {type} of Object.values(this.entries)) {
            size += TypeSizes[type];
        }
    
        return size;
    }

    get numEntries() {
        return this.entryOrder.length;
    }
}