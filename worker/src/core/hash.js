import crypto from 'node:crypto';


function generateHash(buffer){

    return crypto
        .createHash("sha256")
        .update(buffer)
        .digest("hex");

}


export {
    generateHash
};