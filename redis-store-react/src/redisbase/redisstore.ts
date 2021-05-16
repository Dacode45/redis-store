import { BehaviorSubject, Observable, of } from "rxjs";
import { map } from 'rxjs/operators';



export class Redisstore {
    private server: string
    private singletons = new Map();

    constructor(config: { server: string }) {
        this.server = config.server;
    }

    collection(collectionID: string): Collection {
        if (this.singletons.has(collectionID)) {
            return this.singletons.get(collectionID);
        }

        const col = new Collection(this.server, collectionID)
        this.singletons.set(collectionID, col);
        return col;
    }
}

export interface RDoc {
    collectionID: string
    documentID: string
    data: { [k: string]: any }
    updatedAt: number
}

export interface Response {
    kind: string
    collectionID: string
    documentID: string
    requestID: string
    data?: RDoc
    multiData?: RDoc[]
}


function makeid(length) {
    var result = [] as string[];
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result.push(characters.charAt(Math.floor(Math.random() * charactersLength)));
    }
    return result.join('');
}

export class Collection {
    private conn!: WebSocket;
    private server: string;
    private collectionID: string;
    private pending = new Map();

    public documents = new BehaviorSubject([] as RDoc[]);
    public docMap = this.documents.pipe(map(docs => {
        return docs.reduce((m, d) => {
            m.set(d.documentID, d);
            return m;
        }, new Map())
    }));

    _onGotCollection: Set<VoidFunction> = new Set();
    _queries: Set<Query> = new Set();


    public constructor(server: string, collectionID: string) {
        this.server = server;
        this.collectionID = collectionID;
        this.refreshConn();
    }

    add(value): Promise<void> {
        return new Promise((resolve, reject) => {
            let id = 0;
            const done = () => {
                console.log("return from add");
                this._onGotCollection.delete(done);
                resolve(null);
                clearTimeout(id)
            };
            this._onGotCollection.add(done);
            this.conn.send(JSON.stringify({
                type: "post:collection",
                data: value
            }));
            id = setTimeout(done, 100);
        }).then(() => {
            return new Promise((resolve) => {
                const id = makeid(10);
                this.pending.set(id, () => resolve());
                this.conn.send(
                    JSON.stringify({
                        type: "get:collection",
                        requestID: id,
                    })
                );
            });
        });
    }

    refreshConn() {
        console.log("waiting to connect");
        if (this.conn) {
            this.conn.onclose = () => { };
            // this.conn.onmessage = () => { };
            this.conn.onopen = () => { }
        }
        try {
            this.conn = new WebSocket(`wss://${this.server}/collections/${this.collectionID}`);
            this.conn.onclose = () => setTimeout(this.refreshConn.bind(this), 1000);
            this.conn.onmessage = (event) => {
                const response: Response = JSON.parse(event.data);
                console.log("event", response);
                switch (response.kind) {
                    case "got:collection":
                        this.gotCollection(response);
                        return
                }
            }
            this.conn.onopen = (event) => {
                console.log("connected")
                this.conn.send(
                    JSON.stringify({
                        requestID: "test",
                        type: "get:collection",
                    })
                );
            }
        } catch (e) {
            setTimeout(this.refreshConn.bind(this), 1000)
        }
    }

    private gotCollection(response: Response) {
        console.log("gotCollection", response);

        if (response.multiData) {
            this.documents.next(response.multiData.filter(d => d));
        }
        if (this.pending.has(response.requestID)) {
            this.pending.get(response.requestID)();
        }
    }

    public orderBy(key: string): Query {
        const query = new Query(this.documents.pipe(map((documents) => {
            const docs = [...documents];
            const cp = [...docs];
            console.log(cp, key);
            cp.sort((a, b) => {
                const akey = (a[key]) ? (a[key]) : a.data[key] ?? 0;
                const bkey = (b[key]) ? (b[key]) : b.data[key] ?? 0;

                return akey - bkey
            });

            return cp;
        })));

        return query;
    }
}

export class Query {
    docs: Observable<RDoc[]>;
    public constructor(obs: Observable<RDoc[]>) {
        this.docs = obs
    }

    limit(amount: number): Query {
        return new Query(this.docs.pipe(map((docs) => {
            return docs.slice(Math.max(docs.length - amount, 0));
        })));
    }
}