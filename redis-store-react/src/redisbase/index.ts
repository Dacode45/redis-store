import { Redisstore } from "./redisstore";

let REDISSTORE_SERVER = ""


export function initializeApp(config: { server: string }) {
    REDISSTORE_SERVER = config.server;
}

export function redisstore(): Redisstore {
    return new Redisstore({ server: REDISSTORE_SERVER });
}



export const _empty = {};