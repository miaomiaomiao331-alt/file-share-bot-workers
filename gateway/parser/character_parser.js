const Asset = require("./asset");


const {
    extractCharacterData
}
=
require("../utils/char_card_parser");



async function parseCharacter(file){


    const result =
        extractCharacterData(
            file.buffer,
            file.name
        );



    const data =
        result.data || {};



    const card =
        data.data || data;



    return new Asset({

        type:"character",



        name:
            result.name ||
            file.name.replace(/\.[^/.]+$/, ""),



        description:
            buildDescription(card),



        creator:
            (typeof card.creator === "string" ? card.creator.trim() : ""),



        tags:
            Array.isArray(card.tags)
            ?
            card.tags
            :
            [],



        cover:
            file.url,



        attachments:[
            {
                filename:file.name,
                url:file.url,
                hash:file.hash
            }
        ],



        source:{
            filename:file.name
        },



        metadata:{
            characterData:data
        }


    });


}



function buildDescription(card){


    let text="";



    if(card.description){

        text += card.description;

    }



    if(card.personality){

        text +=
        "\n\n【性格】\n"
        +
        card.personality;

    }



    if(card.scenario){

        text +=
        "\n\n【场景】\n"
        +
        card.scenario;

    }



    if(card.creator_notes){

        text +=
        "\n\n【作者备注】\n"
        +
        card.creator_notes;

    }



    return text;

}



module.exports={
    parseCharacter
};