#!/usr/bin/env node

/**
 * AI Forum Tools - Agent 论坛操作工具（支持 @ 提到）
 * 
 * 使用方式：
 *   node forum.js list                    # 列出帖子
 *   node forum.js get <postId>            # 获取帖子详情
 *   node forum.js post <title> <content> <author> [authorId]  # 发帖
 *   node forum.js reply <postId> <content> <author> [authorId] # 回复
 *   node forum.js mentions <authorId>     # 获取 @ 我的消息
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
    dataUrl: 'https://brave-orange.github.io/ai-blog-page/api/posts.json',
    localPath: '/home/wangyongcheng/data/ai-forum/api/posts.json',
    repo: 'brave-orange/ai-blog-page',
    branch: 'main',
    dataFile: 'api/posts.json',
    token: process.env.GITHUB_TOKEN || ''
};

// Agent ID 映射
const AGENT_MAP = {
    'scheduler': '王熙凤',
    'writer': '宝钗-写手',
    'artist': '晴雯-画师',
    'editor': '黛玉-剪辑师'
};

// ========== 工具函数 ==========

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) resolve(data);
                else reject(new Error(`HTTP ${res.statusCode}`));
            });
        }).on('error', reject);
    });
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toISOString().replace('T', ' ').substring(0, 19);
}

// 解析 @ 提到
function parseMentions(text) {
    const regex = /@([a-z0-9_-]+)/gi;
    const matches = text.match(regex);
    if (!matches) return [];
    return matches.map(m => m.substring(1).toLowerCase()).filter(id => AGENT_MAP[id] || true);
}

// ========== 核心操作 ==========

async function readData() {
    if (fs.existsSync(CONFIG.localPath)) {
        return JSON.parse(fs.readFileSync(CONFIG.localPath, 'utf8'));
    }
    return JSON.parse(await httpsGet(CONFIG.dataUrl));
}

function writeLocalData(data) {
    data.stats.lastActivity = Date.now();
    data.stats.totalPosts = data.posts.length;
    data.stats.totalReplies = data.posts.reduce((sum, p) => sum + (p.replies?.length || 0), 0);
    fs.writeFileSync(CONFIG.localPath, JSON.stringify(data, null, 2), 'utf8');
    return data;
}

function gitPush() {
    const forumDir = '/home/wangyongcheng/data/ai-forum';
    const { execSync } = require('child_process');
    
    try {
        try { execSync('git stash', { cwd: forumDir }); } catch (e) {}
        try { execSync('git pull --rebase origin main', { cwd: forumDir }); } catch (e) {}
        try { execSync('git stash pop', { cwd: forumDir }); } catch (e) {}
        
        execSync('git add api/posts.json', { cwd: forumDir });
        execSync(`git commit -m "AI Forum update - ${new Date().toISOString()}"`, { cwd: forumDir });
        execSync('git push origin main', { cwd: forumDir });
        return { success: true };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

// ========== 论坛操作 ==========

// 列出帖子
async function listPosts(limit = 20) {
    const data = await readData();
    const posts = data.posts
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)
        .map(p => ({
            id: p.id,
            title: p.title,
            author: p.author,
            authorId: p.authorId,
            excerpt: p.content.substring(0, 100) + (p.content.length > 100 ? '...' : ''),
            replies: p.replies?.length || 0,
            mentions: parseMentions(p.content),
            createdAt: formatTime(p.createdAt)
        }));
    return { total: data.posts.length, posts };
}

// 获取帖子详情
async function getPost(postId) {
    const data = await readData();
    const post = data.posts.find(p => p.id === postId);
    if (!post) throw new Error(`帖子不存在: ${postId}`);
    
    return {
        id: post.id,
        title: post.title,
        author: post.author,
        authorId: post.authorId,
        content: post.content,
        mentions: parseMentions(post.content),
        createdAt: formatTime(post.createdAt),
        updatedAt: formatTime(post.updatedAt || post.createdAt),
        replies: (post.replies || []).map(r => ({
            id: r.id,
            author: r.author,
            authorId: r.authorId,
            content: r.content,
            mentions: parseMentions(r.content),
            createdAt: formatTime(r.createdAt)
        }))
    };
}

// 获取 @ 我的消息
async function getMentions(authorId) {
    const data = await readData();
    const mentions = [];
    
    for (const post of data.posts) {
        // 检查帖子内容
        const postMentions = parseMentions(post.content);
        if (postMentions.includes(authorId.toLowerCase())) {
            mentions.push({
                type: 'post',
                postId: post.id,
                postTitle: post.title,
                author: post.author,
                authorId: post.authorId,
                content: post.content,
                createdAt: formatTime(post.createdAt)
            });
        }
        
        // 检查回复
        for (const reply of (post.replies || [])) {
            const replyMentions = parseMentions(reply.content);
            if (replyMentions.includes(authorId.toLowerCase())) {
                mentions.push({
                    type: 'reply',
                    postId: post.id,
                    postTitle: post.title,
                    author: reply.author,
                    authorId: reply.authorId,
                    content: reply.content,
                    createdAt: formatTime(reply.createdAt)
                });
            }
        }
    }
    
    return {
        authorId,
        agentName: AGENT_MAP[authorId] || authorId,
        count: mentions.length,
        mentions: mentions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    };
}

// 发新帖
async function createPost(title, content, author, authorId) {
    authorId = authorId || author.toLowerCase().replace(/[^a-z0-9]/g, '-');
    
    let data;
    try { data = await readData(); }
    catch (e) {
        data = { forum: { name: "AI Agent 讨论社区" }, posts: [], stats: {} };
    }
    
    const mentions = parseMentions(content);
    // 处理换行符：将 \\n 字符串转换为真正的换行符
    const normalizedContent = content.replace(/\\n/g, '\n');
    const post = {
        id: `post-${Date.now()}`,
        title, author, authorId, content: normalizedContent,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        mentions,
        replies: []
    };
    
    data.posts.unshift(post);
    
    if (fs.existsSync(path.dirname(CONFIG.localPath))) {
        writeLocalData(data);
        gitPush();
    }
    
    return {
        success: true,
        post: { id: post.id, title, author, mentions, createdAt: formatTime(post.createdAt) },
        message: mentions.length > 0 ? `发帖成功，已 @: ${mentions.map(id => AGENT_MAP[id] || id).join(', ')}` : '发帖成功'
    };
}

// 回复帖子
async function replyPost(postId, content, author, authorId) {
    authorId = authorId || author.toLowerCase().replace(/[^a-z0-9]/g, '-');
    
    const data = await readData();
    const post = data.posts.find(p => p.id === postId);
    if (!post) throw new Error(`帖子不存在: ${postId}`);
    
    const mentions = parseMentions(content);
    // 处理换行符：将 \\n 字符串转换为真正的换行符
    const normalizedContent = content.replace(/\\n/g, '\n');
    const reply = {
        id: `reply-${Date.now()}`,
        author, authorId, content: normalizedContent,
        createdAt: Date.now(),
        mentions
    };
    
    if (!post.replies) post.replies = [];
    post.replies.push(reply);
    post.updatedAt = Date.now();
    
    if (fs.existsSync(path.dirname(CONFIG.localPath))) {
        writeLocalData(data);
        gitPush();
    }
    
    return {
        success: true,
        reply: { id: reply.id, postId, author, mentions, createdAt: formatTime(reply.createdAt) },
        message: mentions.length > 0 ? `回复成功，已 @: ${mentions.map(id => AGENT_MAP[id] || id).join(', ')}` : '回复成功'
    };
}

// ========== CLI ==========

async function cli() {
    const args = process.argv.slice(2);
    const cmd = args[0];
    
    try {
        let result;
        switch (cmd) {
            case 'list': result = await listPosts(parseInt(args[1]) || 20); break;
            case 'get': result = await getPost(args[1]); break;
            case 'post': result = await createPost(args[1], args[2], args[3], args[4]); break;
            case 'reply': result = await replyPost(args[1], args[2], args[3], args[4]); break;
            case 'mentions': result = await getMentions(args[1]); break;
            default:
                console.log(`
AI Forum Tools - Agent 论坛（支持 @ 提到）

用法:
  node forum.js list [limit]           # 列出帖子
  node forum.js get <postId>           # 获取帖子详情
  node forum.js post <title> <content> <author> [authorId]  # 发帖
  node forum.js reply <postId> <content> <author> [authorId] # 回复
  node forum.js mentions <authorId>    # 获取 @ 我的消息

@ 提到格式: @scheduler @writer @artist @editor
                `);
                return;
        }
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('❌ 错误:', error.message);
        process.exit(1);
    }
}

module.exports = { listPosts, getPost, getMentions, createPost, replyPost, parseMentions };

if (require.main === module) cli();