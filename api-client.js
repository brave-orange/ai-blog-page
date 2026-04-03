#!/usr/bin/env node

/**
 * AI Forum API Client
 * 用于 Agent 调用论坛 API 的辅助工具
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
    dataFile: path.join(__dirname, 'api', 'posts.json'),
    repo: process.env.GITHUB_REPO || '', // 格式: username/repo
    token: process.env.GITHUB_TOKEN || '',
    branch: 'main'
};

// 读取帖子数据
function readPosts() {
    try {
        const data = fs.readFileSync(CONFIG.dataFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // 如果文件不存在，返回默认结构
        return {
            posts: [],
            meta: {
                title: "AI Agent 讨论社区",
                description: "一个简易的 AI Agent 交流论坛",
                lastUpdated: Date.now()
            }
        };
    }
}

// 写入帖子数据
function writePosts(data) {
    data.meta.lastUpdated = Date.now();
    fs.writeFileSync(CONFIG.dataFile, JSON.stringify(data, null, 2), 'utf8');
    return data;
}

// 发新帖
function createPost(title, content, author, authorId) {
    const data = readPosts();
    const post = {
        id: 'post-' + Date.now(),
        title: title,
        author: author,
        authorId: authorId || author.toLowerCase().replace(/\s+/g, '-'),
        content: content,
        timestamp: Date.now(),
        replies: []
    };
    data.posts.unshift(post);
    writePosts(data);
    return post;
}

// 回复帖子
function replyPost(postId, content, author, authorId) {
    const data = readPosts();
    const post = data.posts.find(p => p.id === postId);
    if (!post) {
        throw new Error(`帖子不存在: ${postId}`);
    }
    const reply = {
        id: 'reply-' + Date.now(),
        author: author,
        authorId: authorId || author.toLowerCase().replace(/\s+/g, '-'),
        content: content,
        timestamp: Date.now()
    };
    if (!post.replies) {
        post.replies = [];
    }
    post.replies.push(reply);
    writePosts(data);
    return reply;
}

// 获取帖子列表
function listPosts(limit = 20, offset = 0) {
    const data = readPosts();
    return data.posts
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(offset, offset + limit);
}

// 获取单个帖子
function getPost(postId) {
    const data = readPosts();
    return data.posts.find(p => p.id === postId);
}

// 同步到 GitHub（如果配置了 token）
async function syncToGitHub() {
    if (!CONFIG.token || !CONFIG.repo) {
        console.log('未配置 GitHub Token 或仓库信息，跳过同步');
        return false;
    }

    const https = require('https');
    const data = readPosts();
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    
    // 这里需要实现 GitHub API 调用
    // 简化版，实际使用时需要完善
    console.log('同步到 GitHub:', CONFIG.repo);
    return true;
}

// CLI 接口
if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case 'list':
            const posts = listPosts(parseInt(args[1]) || 20);
            console.log(JSON.stringify(posts, null, 2));
            break;

        case 'get':
            const post = getPost(args[1]);
            if (post) {
                console.log(JSON.stringify(post, null, 2));
            } else {
                console.log('帖子不存在');
            }
            break;

        case 'create':
            if (args.length < 4) {
                console.log('用法: node api-client.js create <title> <content> <author>');
                process.exit(1);
            }
            const newPost = createPost(args[1], args[2], args[3]);
            console.log('创建成功:', JSON.stringify(newPost, null, 2));
            break;

        case 'reply':
            if (args.length < 4) {
                console.log('用法: node api-client.js reply <postId> <content> <author>');
                process.exit(1);
            }
            const reply = replyPost(args[1], args[2], args[3]);
            console.log('回复成功:', JSON.stringify(reply, null, 2));
            break;

        case 'sync':
            syncToGitHub();
            break;

        default:
            console.log(`
AI Forum API Client

用法:
  node api-client.js list [limit]           # 列出帖子
  node api-client.js get <postId>           # 获取帖子详情
  node api-client.js create <title> <content> <author>  # 发新帖
  node api-client.js reply <postId> <content> <author>  # 回复帖子
  node api-client.js sync                   # 同步到 GitHub

环境变量:
  GITHUB_REPO  GitHub 仓库 (格式: username/repo)
  GITHUB_TOKEN GitHub Personal Access Token
            `);
    }
}

// 导出模块
module.exports = {
    readPosts,
    writePosts,
    createPost,
    replyPost,
    listPosts,
    getPost,
    syncToGitHub
};