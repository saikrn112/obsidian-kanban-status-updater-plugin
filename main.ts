import { Plugin, PluginSettingTab, Setting, App, TFile, TFolder, Notice, CachedMetadata } from 'obsidian';

interface KSUSettings {
    statusPropertyName: string;
    showNotifications: boolean;
    debugMode: boolean;
}

const DEFAULT_SETTINGS: KSUSettings = {
    statusPropertyName: 'status',
    showNotifications: false,
    debugMode: false,
};

// Quadrant columns map to status: backlog with specific urgent/important values
const QUADRANT_MAP: Record<string, { urgent: boolean; important: boolean }> = {
    '⚪ Eliminate (NI & NU)':  { urgent: false, important: false },
    '🟠 Delegate (NI & U)':   { urgent: true,  important: false },
    '🟡 Schedule (I & NU)':   { urgent: false, important: true },
    '🔴 Do First (I & U)':    { urgent: true,  important: true },
};

const ARCHIVE_STATUSES = new Set(['done', 'archive']);

export default class KanbanStatusUpdaterPlugin extends Plugin {
    settings: KSUSettings;
    private isUpdating = false;
    private boardPaths = new Set<string>();

    async onload() {
        await this.loadSettings();
        this.app.workspace.onLayoutReady(() => this.indexBoards());

        this.registerEvent(this.app.vault.on('modify', (file) => {
            if (this.isUpdating || !(file instanceof TFile) || !this.boardPaths.has(file.path)) return;
            this.syncBoard(file);
        }));

        this.registerEvent(this.app.vault.on('create', () => this.indexBoards()));
        this.registerEvent(this.app.vault.on('rename', () => this.indexBoards()));
        this.registerEvent(this.app.vault.on('delete', (file) => {
            this.boardPaths.delete(file.path);
        }));

        this.addSettingTab(new KSUSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private log(message: string) {
        if (this.settings.debugMode) console.log(`[KSU] ${message}`);
    }

    private indexBoards() {
        this.boardPaths.clear();
        for (const file of this.app.vault.getMarkdownFiles()) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter?.['kanban-plugin']) {
                this.boardPaths.add(file.path);
            }
        }
        this.log(`Indexed ${this.boardPaths.size} board(s)`);
    }

    private async syncBoard(file: TFile) {
        const content = await this.app.vault.cachedRead(file);
        const updates = this.parseBoardContent(content);
        if (updates.length === 0) return;

        this.isUpdating = true;
        for (const { linkPath, columnName } of updates) {
            await this.updateNote(linkPath, columnName);
        }
        this.isUpdating = false;
    }

    private parseBoardContent(content: string): { linkPath: string; columnName: string }[] {
        const updates: { linkPath: string; columnName: string }[] = [];
        let currentColumn: string | null = null;

        for (const line of content.split('\n')) {
            const headingMatch = line.match(/^## (.+)$/);
            if (headingMatch) {
                currentColumn = headingMatch[1].trim();
                continue;
            }
            if (currentColumn) {
                const linkMatch = line.match(/\[\[([^\]]+)\]\]/);
                if (linkMatch) {
                    updates.push({ linkPath: linkMatch[1], columnName: currentColumn });
                }
            }
        }
        return updates;
    }

    private async updateNote(notePath: string, columnName: string) {
        try {
            const file = this.app.metadataCache.getFirstLinkpathDest(notePath, '');
            if (!file) return;

            const isQuadrant = columnName in QUADRANT_MAP;
            const status = isQuadrant ? 'backlog' : columnName;
            const cache: CachedMetadata | null = this.app.metadataCache.getFileCache(file);
            const oldStatus = cache?.frontmatter?.[this.settings.statusPropertyName] ?? null;
            const oldUrgent = cache?.frontmatter?.['urgent'] ?? null;
            const oldImportant = cache?.frontmatter?.['important'] ?? null;

            // Determine if anything needs changing
            let needsUpdate = oldStatus !== status;
            if (isQuadrant) {
                const q = QUADRANT_MAP[columnName];
                needsUpdate = needsUpdate || oldUrgent !== q.urgent || oldImportant !== q.important;
            }
            if (!needsUpdate) return;

            // Update frontmatter
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                fm[this.settings.statusPropertyName] = status;
                if (isQuadrant) {
                    fm['urgent'] = QUADRANT_MAP[columnName].urgent;
                    fm['important'] = QUADRANT_MAP[columnName].important;
                }
            });

            this.log(`${file.basename}: "${oldStatus}" → "${status}"`);
            if (this.settings.showNotifications) {
                new Notice(`${file.basename}: "${oldStatus || '(none)'}" → "${status}"`, 3000);
            }

            // Move to archive if done/archive, or restore if moved out
            if (ARCHIVE_STATUSES.has(status)) {
                await this.archiveNote(file);
            } else {
                await this.unarchiveNote(file);
            }
        } catch (error) {
            console.error(`[KSU] Error updating ${notePath}:`, error);
        }
    }

    private async archiveNote(file: TFile) {
        const parentDir = file.parent?.path;
        if (!parentDir) return;

        // Only move if currently in a tasks/ folder (not already archived)
        if (!parentDir.endsWith('/tasks') && parentDir !== 'tasks') return;

        const archivePath = `${parentDir}/archive`;
        const newPath = `${archivePath}/${file.name}`;

        // Create archive folder if needed
        const archiveFolder = this.app.vault.getAbstractFileByPath(archivePath);
        if (!archiveFolder) {
            await this.app.vault.createFolder(archivePath);
        }

        await this.app.fileManager.renameFile(file, newPath);
        this.log(`Archived: ${file.basename} → ${archivePath}/`);
        if (this.settings.showNotifications) {
            new Notice(`Archived: ${file.basename}`, 3000);
        }
    }

    private async unarchiveNote(file: TFile) {
        const parentDir = file.parent?.path;
        if (!parentDir || !parentDir.endsWith('/tasks/archive')) return;

        const tasksPath = parentDir.replace(/\/archive$/, '');
        const newPath = `${tasksPath}/${file.name}`;

        await this.app.fileManager.renameFile(file, newPath);
        this.log(`Unarchived: ${file.basename} → ${tasksPath}/`);
        if (this.settings.showNotifications) {
            new Notice(`Unarchived: ${file.basename}`, 3000);
        }
    }
}

class KSUSettingTab extends PluginSettingTab {
    plugin: KanbanStatusUpdaterPlugin;

    constructor(app: App, plugin: KanbanStatusUpdaterPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Status property name')
            .setDesc('The frontmatter property to update when a card is moved between columns')
            .addText(text => text
                .setPlaceholder('status')
                .setValue(this.plugin.settings.statusPropertyName)
                .onChange(async (value) => {
                    this.plugin.settings.statusPropertyName = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show notifications')
            .setDesc('Show a notice when a status is updated')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showNotifications)
                .onChange(async (value) => {
                    this.plugin.settings.showNotifications = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Debug logging')
            .setDesc('Log activity to the developer console')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debugMode)
                .onChange(async (value) => {
                    this.plugin.settings.debugMode = value;
                    await this.plugin.saveSettings();
                }));
    }
}
