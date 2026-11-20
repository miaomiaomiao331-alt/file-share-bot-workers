require("dotenv").config();
const {
    sendLog
}=require("../utils/logger");
const {
    createClient
}=require("@supabase/supabase-js");


const supabase =
createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);


module.exports={
    supabase
};