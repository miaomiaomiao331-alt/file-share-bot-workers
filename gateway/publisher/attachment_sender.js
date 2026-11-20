const {
    sendLog
}=require("../utils/logger");

async function sendAttachment(
    thread,
    attachment,
    asset = null   // 新增参数，用于日志记录
){

    console.log(
        "[AttachmentSender] 准备发送:",
        attachment.name
    );


    await thread.send({

        content:
        `📦 新增文件：${attachment.name}`,

        files:[
            {
                attachment:
                attachment.buffer,

                name:
                attachment.name
            }
        ]

    });


    console.log(
        "[AttachmentSender] 发送成功"
    );

    // 新增日志记录（仅当提供了 asset）
    if (asset) {
        await sendLog(
            thread.client,
            "success",
            {
                module: "Attachment Sender",
                operation: "追加附件",
                message:
`
角色: ${asset.identity || asset.name}
文件: ${attachment.name}
Thread: ${thread.id}
状态: 成功
`
            }
        );
    }
}


module.exports = {
    sendAttachment
};