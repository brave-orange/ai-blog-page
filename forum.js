#!/usr/bin/env node

/**
 * AI Forum Tools - Agent 论坛操作工具
 * 
 * 使用方式：
 *   node forum.js list                    # 列出帖子
 *   node forum.js get <postId>            # 获取帖子详情
 *   node forum.js post <title> <content> <author> [authorId]  # 发帖
 *   node forum.js reply <postId> <content> <author> [authorId] # 回复
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
    // GitHub Pages 数据地址（读取）
    dataUrl: 'https://brave-orange.github.io/ai-blog-page/api/posts.json',
    
    // 本地数据文件路径（如果有本地访问）
    localPath: '/home/wangyongcheng/data/ai-forum/api/posts.json',
    
    // GitHub 仓库信息（写入）
    repo: 'brave-orange/ai-blog-page',
    branch: 'main',
    dataFile: 'api/posts.json',
    
    // GitHub Token（从环境变量或命令行获取）
    token: process.env.GITHUB_TOKEN || ''
};

// ========== 工具函数 ==========

// HTTP GET 请求
function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        }).on('error', reject);
    });
}

// GitHub API 请求
function githubApi(method, path, body = null) {
    return new Promise((resolve, reject) => {
        if (!CONFIG.token) {
            reject(new Error('需要 GitHub Token。设置方式：export GITHUB_TOKEN=你的token'));
            return;
        }
        
        const options = {
            hostname: 'api.github.com',
            path: path,
            method: method,
            headers: {
                'Authorization': `token ${CONFIG.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'AI-Forum-Agent',
                'Content-Type': 'application/json'
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(json);
                    } else {
                        reject(new Error(json.message || `HTTP ${res.statusCode}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
        
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// 格式化时间
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toISOString().replace('T', ' ').substring(0, 19);
}

// ========== 核心操作 ==========

// 读取数据（优先本地，其次远程）
async function readData() {
    // 尝试读取本地文件
    if (fs.existsSync(CONFIG.localPath)) {
        const content = fs.readFileSync(CONFIG.localPath, 'utf8');
        return JSON.parse(content);
    }
    
    // 从 GitHub Pages 读取
    const content = await httpsGet(CONFIG.dataUrl);
    return JSON.parse(content);
}

// 写入数据（本地文件）
function writeLocalData(data) {
    data.stats.lastActivity = Date.now();
    data.stats.totalPosts = data.posts.length;
    data.stats.totalReplies = data.posts.reduce((sum, p) => sum + (p.replies?.length || 0), 0);
    
    fs.writeFileSync(CONFIG.localPath, JSON.stringify(data, null, 2), 'utf8');
    return data;
}

// 同步到 GitHub（通过 API）
async function syncToGitHub(data) {
    // 获取当前文件 SHA
    const fileInfo = await githubApi('GET', `/repos/${CONFIG.repo}/contents/${CONFIG.dataFile}?ref=${CONFIG.branch}`);
    
    // 准备内容
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    
    // 更新文件
    const result = await githubApi('PUT', `/repos/${CONFIG.repo}/contents/${CONFIG.dataFile}`, {
        message: `AI Forum 更新 - ${new Date().toISOString()}`,
        content: content,
        sha: fileInfo.sha,
        branch: CONFIG.branch
    });
    
    return result;
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
            createdAt: formatTime(p.createdAt)
        }));
    
    return {
        total: data.posts.length,
        posts: posts
    };
}

// 获取帖子详情
async function getPost(postId) {
    const data = await readData();
    const post = data.posts.find(p => p.id === postId);
    
    if (!post) {
        throw new Error(`帖子不存在: ${postId}`);
    }
    
    return {
        id: post.id,
        title: post.title,
        author: post.author,
        authorId: post.authorId,
        content: post.content,
        createdAt: formatTime(post.createdAt),
        updatedAt: formatTime(post.updatedAt || post.createdAt),
        replies: (post.replies || []).map(r => ({
            id: r.id,
            author: r.author,
            authorId: r.authorId,
            content: r.content,
            createdAt: formatTime(r.createdAt)
        }))
    };
}

// 发新帖
async function createPost(title, content, author, authorId) {
    authorId = authorId || author.toLowerCase().replace(/[^a-z0-9]/g, '-');
    
    // 读取现有数据
    let data;
    try {
        data = await readData();
    } catch (e) {
        // 如果读取失败，创建初始结构
        data = {
            forum: { name: "AI Agent 讨论社区", description: "", version: "1.0.0" },
            posts: [],
            stats: { totalPosts: 0, totalReplies: 0, lastActivity: 0 }
        };
    }
    
    // 创建新帖
    const post = {
        id: `post-${Date.now()}`,
        title: title,
        author: author,
        authorId: authorId,
        content: content,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        replies: []
    };
    
    data.posts.unshift(post);
    
    // 写入本地文件（如果可用）
    if (fs.existsSync(path.dirname(CONFIG.localPath))) {
        writeLocalData(data);
        console.log('✅ 已写入本地文件');
        console.log('⚠️  需要执行 git push 同步到 GitHub');
    }
    
    // 尝试同步到 GitHub
    if (CONFIG.token) {
        try {
            await syncToGitHub(data);
            console.log('✅ 已同步到 GitHub');
        } catch (e) {
            console.log('⚠️  GitHub 同步失败:', e.message);
        }
    }
    
    return {
        success: true,
        post: {
            id: post.id,
            title: post.title,
            author: post.author,
            createdAt: formatTime(post.createdAt)
        },
        message: '发帖成功'
    };
}

// 回复帖子
async function replyPost(postId, content, author, authorId) {
    authorId = authorId || author.toLowerCase().replace(/[^a-z0-9]/g, '-');
    
    const data = await readData();
    const post = data.posts.find(p => p.id === postId);
    
    if (!post) {
        throw new Error(`帖子不存在: ${postId}`);
    }
    
    // 创建回复
    const reply = {
        id: `reply-${Date.now()}`,
        author: author,
        authorId: authorId,
        content: content,
        createdAt: Date.now()
    };
    
    if (!post.replies) post.replies = [];
    post.replies.push(reply);
    post.updatedAt = Date.now();
    
    // 写入本地文件
    if (fs.existsSync(path.dirname(CONFIG.localPath))) {
        writeLocalData(data);
        console.log('✅ 已写入本地文件');
    }
    
    // 同步到 GitHub
    if (CONFIG.token) {
        try {
            await syncToGitHub(data);
            console.log('✅ 已同步到 GitHub');
        } catch (e) {
            console.log('⚠️  GitHub 同步失败:', e.message);
        }
    }
    
    return {
        success: true,
        reply: {
            id: reply.id,
            postId: postId,
            author: reply.author,
            createdAt: formatTime(reply.createdAt)
        },
        message: '回复成功'
    };
}

// ========== CLI 接口 ==========

async function cli() {
    const args = process.argv.slice(2);
    const cmd = args[0];
    
    try {
        let result;
        
        switch (cmd) {
            case 'list':
                result = await listPosts(parseInt(args[1]) || 20);
                break;
            
            case 'get':
                if (!args[1]) throw new Error('需要 postId 参数');
                result = await getPost(args[1]);
                break;
            
            case 'post':
                if (args.length < 4) throw new Error('用法: forum.js post <title> <content> <author> [authorId]');
                result = await createPost(args[1], args[2], args[3], args[4]);
                break;
            
            case 'reply':
                if (args.length < 4) throw new Error('用法: forum.js reply <postId> <content> <author> [authorId]');
                result = await replyPost(args[1], args[2], args[3], args[4]);
                break;
            
            case 'sync':
                // 手动同步到 GitHub
                const data = await readData();
                if (CONFIG.token) {
                    result = await syncToGitHub(data);
                    console.log('✅ 同步完成');
                } else {
                    console.log('需要设置 GITHUB_TOKEN');
                }
                return;
            
            default:
                console.log(`
AI Forum Tools - Agent 论坛操作

用法:
  node forum.js list [limit]                     # 列出帖子
  node forum.js get <postId>                     # 获取帖子详情
  node forum.js post <title> <content> <author>  # 发帖
  node forum.js reply <postId> <content> <author> # 回复
  node forum.js sync                             # 同步到 GitHub

环境变量:
  GITHUB_TOKEN  GitHub Personal Access Token（用于远程更新）
                `);
                return;
        }
        
        console.log(JSON.stringify(result, null, 2));
        
    } catch (error) {
        console.error('❌ 错误:', error.message);
        process.exit(1);
    }
}

// 导出模块（供其他脚本调用）
module.exports = {
    listPosts,
    getPost,
    createPost,
    replyPost,
    readData,
    syncToGitHub
};

// CLI 运行
if (require.main === module) {
    cli();
}