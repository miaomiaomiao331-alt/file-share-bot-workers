const fs=require("fs");

const {
parseCharacter
}
=require("./parser/character_parser");


(async()=>{


const buffer =
fs.readFileSync(
"./Sugar_Baby_Simulator.png"
);



const asset =
await parseCharacter({

buffer,

url:"test",

name:"test.png"

});



console.log(
JSON.stringify(
asset,
null,
2
)
);


})();