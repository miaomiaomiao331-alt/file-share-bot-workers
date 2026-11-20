const path = require('path');
const { config } = require('../config/config');
const BotClient = require('./client');
const CommandRegistry = require('../utils/command_registry');
const CommandService = require('./services/command_service');
const CommandHandler = require('./interactions/command_handler');
const ButtonHandler = require('./interactions/button_handler');
const ModalSubmitHandler = require('./interactions/modal_submit_handler');
const ApiPanelHandler = require('../handler/llm/api_panel_handler');
const { autoTagThread } = require('../utils/auto_tagger');
const Importer =require('../importer');

class Bot {
    constructor() {
        this.botClient = new BotClient();
        this.client = this.botClient.getClient();
        this.commandRegistry = new CommandRegistry();
        this.commandService = new CommandService();
        this.commandHandler = new CommandHandler(this.commandRegistry);
        this.buttonHandler = new ButtonHandler();
        this.modalSubmitHandler = new ModalSubmitHandler();
        this.apiPanelHandler = ApiPanelHandler;

        this.setupInteractionHandlers();
        this.setupAutoTagger();
        this.setupImporter();
    }

    setupInteractionHandlers() {
        this.client.on('interactionCreate', async (interaction) => {
            // [测试开关] 记录所有的动作日志到本地文件
            try {
                require('../utils/test_activity_logger').logInteraction(interaction);
            } catch (err) {
                console.error('[Top-Level Event Router Logger Error]', err);
            }

            if (await this.commandHandler.handleInteraction(interaction)) return;

            // API 设置面板的按钮/选择菜单 — 在通用按钮处理器之前
            if (await this.apiPanelHandler.handleInteraction(interaction)) return;

            // API 设置面板的模态框
            if (await this.apiPanelHandler.handleModal(interaction)) return;

            if (await this.buttonHandler.handleInteraction(interaction)) return;
            if (await this.modalSubmitHandler.handleInteraction(interaction)) return;
        });
    }

    setupAutoTagger() {
        this.client.on('threadCreate', async (thread) => {
            // 论坛中创建的新帖子
            if (thread.parent?.type === 15) { // 15 = Forum channel
                console.log('[auto_tagger] 检测到新帖子:', thread.name);
                // 异步执行，不阻塞
                autoTagThread(thread).catch(err => {
                    console.error('[auto_tagger] 自动打标签出错:', err);
                });
            }
        });
    }
    setupImporter(){

        const importer =
            new Importer(this.client);


        importer.start();

    }

    async setupCommands() {
        const guildIds = config.get('bot_config.main_config.safety_setting.command_push_guildids', []);

        this.commandRegistry.loadCommands(path.join(__dirname, '../command'));
        this.commandRegistry.loadHandlers(path.join(__dirname, '../handler'));

        const commands = this.commandRegistry.getAllCommands();
        if (commands.length > 0) {
            this.commandService.initialize(process.env.DISCORD_TOKEN);
            await this.commandService.registerCommands(this.client.user.id, commands, guildIds);
        }
    }

    async start() {
        this.client.once('ready', async () => {
            await this.setupCommands();
            console.log('[bot] 所有模块初始化完成，机器人就绪！');
            // Signal PM2 that we are ready
            if (process.send) process.send('ready');
        });

        await this.botClient.login();
    }
}

module.exports = Bot;
