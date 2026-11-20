const fs = require("fs");
const path = require("path");
const {supabase}=require("./supabase");
const CACHE_LIMIT =Number(process.env.ASSET_CACHE_LIMIT || 100);

const BACKUP_DIR =
    path.join(
        __dirname,
        "../data/assets_backup"
    );



function ensureDir(){

    if(!fs.existsSync(BACKUP_DIR)){

        fs.mkdirSync(
            BACKUP_DIR,
            {
                recursive:true
            }
        );

    }

}

function cleanupCache(){


    const files =
    fs.readdirSync(BACKUP_DIR)
    .filter(
        file =>
        file.endsWith(".json")
    );


    if(
        files.length <= CACHE_LIMIT
    ){
        return;
    }



    const fileStats =
    files.map(file=>({

        file,

        time:
        fs.statSync(
            path.join(
                BACKUP_DIR,
                file
            )
        ).mtimeMs

    }))
    .sort(
        (a,b)=>
        a.time-b.time
    );



    const removeCount =
    files.length-CACHE_LIMIT;



    for(
        let i=0;
        i<removeCount;
        i++
    ){


        fs.unlinkSync(
            path.join(
                BACKUP_DIR,
                fileStats[i].file
            )
        );


        console.log(
            "[Storage] 清理缓存:",
            fileStats[i].file
        );


    }

}


async function saveAsset(asset){

    console.log(
        "[Storage] 收到Asset:",
        asset
    );
    await saveToSupabase(asset);


    ensureDir();


    const file =
        path.join(
        BACKUP_DIR,
        `${asset.id}.json`
    );


    console.log(
        "[Storage] 保存路径:",
        file
    );


    fs.writeFileSync(
        file,
        JSON.stringify(
            asset,
            null,
            2
        ),
        "utf8"
    );


    console.log(
    "[Storage] 保存成功"
    );


    cleanupCache();

}





async function getAsset(id){


    const {
        data,
        error
    } =
    await supabase
    .from("assets")
    .select(`
        *,
        attachments(*)
    `)
    .eq(
        "id",
        id
    )
    .single();



    if(
        data &&
        !error
    ){

        return {

            id:data.id,

            identity:data.identity,

            name:data.name,

            description:data.description,

            creator:data.creator,

            cover:data.cover,

            attachments:
            data.attachments || [],

            forum:{
                threadId:data.thread_id
            }

        };

    }



    console.log(
        "[Supabase] Asset不存在，查询本地"
    );



    const file =
    path.join(
        BACKUP_DIR,
        `${id}.json`
    );



    if(
        !fs.existsSync(file)
    ){

        return null;

    }



    return JSON.parse(
        fs.readFileSync(
            file,
            "utf8"
        )
    );


}

async function findBySource(filename){

    ensureDir();


    const files =
        fs.readdirSync(BACKUP_DIR);



    for(
        const file of files
    ){

        if(
            !file.endsWith(".json")
        )
            continue;



        const asset =
            JSON.parse(
                fs.readFileSync(
                    path.join(
                        BACKUP_DIR,
                        file
                    ),
                    "utf8"
                )
            );



        if(
            asset.source &&
            asset.source.filename === filename
        ){

            return asset;

        }

    }


    return null;

}

async function findByIdentity(identity){


    const {
        data,
        error
    } =
    await supabase
    .from("assets")
    .select(`
        *,
        attachments(*)
    `)
    .eq(
        "identity",
        identity
    )
    .limit(1)
    .maybeSingle();



    if(
        data &&
        !error
    ){

        return {

            id:data.id,

            identity:data.identity,

            name:data.name,

            description:data.description,

            creator:data.creator,

            cover:data.cover,

            attachments:
            data.attachments || [],

            forum:{
                threadId:data.thread_id
            }

        };

    }



    console.log(
        "[Supabase] 未找到，查询本地"
    );


    ensureDir();


    const files =
    fs.readdirSync(BACKUP_DIR);



    for(
        const file of files
    ){

        if(
            !file.endsWith(".json")
        )
            continue;



        const asset =
        JSON.parse(
            fs.readFileSync(
                path.join(
                    BACKUP_DIR,
                    file
                ),
                "utf8"
            )
        );



        if(
            asset.identity===identity
        ){

            return asset;

        }

    }


    return null;

}
async function findByHash(hash){


    const {
        data,
        error
    } =
    await supabase
    .from("attachments")
    .select(`
        *,
        assets(*)
    `)
    .eq(
        "hash",
        hash
    )
    .limit(1)
    .maybeSingle();



    if(
        data &&
        !error
    ){

        return data.assets;

    }


    console.log(
        "[Supabase] Hash未找到，查询本地"
    );



    ensureDir();



    const files =
    fs.readdirSync(BACKUP_DIR);



    for(
        const file of files
    ){

        if(
            !file.endsWith(".json")
        )
            continue;



        const asset =
        JSON.parse(
            fs.readFileSync(
                path.join(
                    BACKUP_DIR,
                    file
                ),
                "utf8"
            )
        );



        const exists =
        asset.attachments?.find(
            item =>
            item.hash===hash
        );



        if(exists){

            return asset;

        }

    }


    return null;

}
async function saveToSupabase(asset){


    const {
        error:assetError
    }=
    await supabase
    .from("assets")
    .upsert({

        id:asset.id,

        identity:asset.identity,

        name:asset.name,

        description:asset.description,

        creator:asset.creator,

        cover:asset.cover,

        thread_id:
        asset.forum?.threadId

    });



    if(assetError){

        console.error(
            "[Supabase] assets保存失败:",
            assetError
        );

        return;

    }



    // 先查该 asset 已有的附件 hash，只插入新增的，避免重复行
    // （重复行会让 findByHash 的查询多行报错，导致查重失效）
    let existingHashes = new Set();
    try {
        const { data: existRows } = await supabase
            .from("attachments")
            .select("hash")
            .eq("asset_id", asset.id);
        if (Array.isArray(existRows)) {
            existingHashes = new Set(existRows.map(r => r.hash));
        }
    } catch (e) {
        console.error("[Supabase] 查询已有附件失败:", e.message);
    }

    for (const file of asset.attachments || []) {
        if (file.hash && existingHashes.has(file.hash)) continue;

        const { error: fileError } = await supabase
            .from("attachments")
            .insert({
                asset_id: asset.id,
                filename: file.filename,
                url: file.url,
                hash: file.hash,
            });

        if (fileError) {
            console.error(
                "[Supabase] attachment保存失败:",
                fileError
            );
        } else if (file.hash) {
            existingHashes.add(file.hash);
        }
    }


    console.log(
        "[Supabase] 保存成功"
    );

}
module.exports={
saveAsset,
getAsset,
findBySource,
findByHash,
findByIdentity

};