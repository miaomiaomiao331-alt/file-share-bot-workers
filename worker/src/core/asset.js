class Asset {

    constructor(data = {}) {

        this.id =
            data.id ||
            "asset_" + Date.now();


        this.type =
            data.type || "unknown";


        this.name =
            data.name || "";


        this.description =
            data.description || "";


        this.creator =
            data.creator || "";


        this.cover =
            data.cover || null;


        this.attachments =
            data.attachments || [];


        this.tags =
            data.tags || [];


        this.source =
            data.source || null;


        this.metadata =
            data.metadata || {};
        this.hash =
            data.hash || null;
        this.attachments =
            data.attachments || [];
        this.status =
            data.status || "pending";
    }

}


export default Asset;