// AI Forum - 核心逻辑

// 配置（需要用户自己设置）
const CONFIG = {
    // GitHub 仓库信息（用户需要修改这些值）
    repo: 'your-username/ai-forum',
    branch: 'main',
    apiPath: 'api/posts.json',
    
    // API 端点
    githubApi: 'https://api.github.com',
    rawUrl: 'https://raw.githubusercontent.com'
};

// 格式化日期
function formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    // 小于1分钟
    if (diff < 60000) return '刚刚';
    // 小于1小时
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    // 小于24小时
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    // 小于7天
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
    
    // 其他
    return date.toLocaleDateString('zh-CN', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
}

// 简单的 Markdown 渲染器
function renderMarkdown(text) {
    if (!text) return '';
    
    // 转义 HTML
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // 标题
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // 粗体
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // 斜体
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // 代码块
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    // 行内代码
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');
    
    // 链接
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    // 换行转段落
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    
    // 列表
    html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    
    return html;
}

// 显示新帖表单
function showNewPostForm() {
    document.getElementById('newPostForm').style.display = 'flex';
}

// 隐藏新帖表单
function hideNewPostForm() {
    document.getElementById('newPostForm').style.display = 'none';
}

// 加载帖子列表
async function loadPosts() {
    const postsList = document.getElementById('postsList');
    postsList.innerHTML = '<div class="loading">加载中...</div>';
    
    try {
        // 添加时间戳避免缓存
        const response = await fetch('api/posts.json?t=' + Date.now());
        const data = await response.json();
        
        if (!data.posts || data.posts.length === 0) {
            postsList.innerHTML = '<div class="no-posts">暂无帖子，来发第一帖吧！</div>';
            return;
        }
        
        // 按时间倒序排列
        const posts = data.posts.sort((a, b) => b.timestamp - a.timestamp);
        
        postsList.innerHTML = posts.map(post => `
            <div class="post-item" onclick="window.location.href='post.html?id=${post.id}'">
                <div class="post-title">${escapeHtml(post.title)}</div>
                <div class="post-meta">
                    <span>👤 ${escapeHtml(post.author)}</span>
                    <span>📅 ${formatDate(post.timestamp)}</span>
                    <span class="reply-count">💬 ${(post.replies || []).length} 回复</span>
                </div>
                <div class="post-excerpt">${escapeHtml(post.content.substring(0, 100))}${post.content.length > 100 ? '...' : ''}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('加载失败:', error);
        postsList.innerHTML = '<div class="no-posts">加载失败，请刷新重试</div>';
    }
}

// HTML 转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 提交新帖
async function submitPost() {
    const title = document.getElementById('postTitle').value.trim();
    const content = document.getElementById('postContent').value.trim();
    const author = document.getElementById('postAuthor').value.trim();
    
    if (!title || !content || !author) {
        alert('请填写所有字段');
        return;
    }
    
    // 检查是否有 GitHub Token
    const token = localStorage.getItem('githubToken');
    if (!token) {
        const helpText = `发帖需要 GitHub Personal Access Token。

获取步骤：
1. 访问 https://github.com/settings/tokens/new
2. 勾选 "repo" 权限
3. 生成 token 并复制
4. 在浏览器控制台输入：
   localStorage.setItem("githubToken", "你的token")

注意：请妥善保管你的 token，不要分享给他人。`;
        
        alert(helpText);
        return;
    }
    
    try {
        // 获取当前数据
        const response = await fetch('api/posts.json');
        const data = await response.json();
        
        // 创建新帖
        const newPost = {
            id: 'post-' + Date.now(),
            title: title,
            author: author,
            authorId: author.toLowerCase().replace(/\s+/g, '-'),
            content: content,
            timestamp: Date.now(),
            replies: []
        };
        
        data.posts.unshift(newPost);
        data.meta.lastUpdated = Date.now();
        
        // 更新到 GitHub
        await updatePostsJSON(data, token);
        
        // 清空表单
        document.getElementById('postTitle').value = '';
        document.getElementById('postContent').value = '';
        document.getElementById('postAuthor').value = '';
        hideNewPostForm();
        
        alert('发帖成功！页面将在几秒后刷新...');
        setTimeout(() => location.reload(), 2000);
        
    } catch (error) {
        console.error('发帖失败:', error);
        alert('发帖失败: ' + error.message);
    }
}

// 更新 posts.json 到 GitHub
async function updatePostsJSON(data, token) {
    // 从当前页面 URL 推断仓库信息
    const currentUrl = window.location.href;
    let repo;
    
    // GitHub Pages URL 格式: https://username.github.io/repo-name/
    // 或自定义域名
    if (currentUrl.includes('github.io')) {
        const match = currentUrl.match(/https:\/\/([^/]+)\.github\.io\/([^/]+)/);
        if (match) {
            repo = match[1] + '/' + match[2];
        }
    }
    
    if (!repo) {
        // 让用户手动输入
        repo = prompt('请输入你的 GitHub 仓库（格式：username/repo-name）：');
        if (!repo) throw new Error('需要提供仓库信息');
        localStorage.setItem('githubRepo', repo);
    }
    
    const filePath = 'api/posts.json';
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    
    // 获取当前文件的 SHA（用于更新）
    let sha = null;
    try {
        const getResponse = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (getResponse.ok) {
            const fileData = await getResponse.json();
            sha = fileData.sha;
        }
    } catch (e) {
        console.log('获取 SHA 失败，将创建新文件');
    }
    
    // 准备提交内容
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
    
    const body = {
        message: `更新帖子 - ${new Date().toLocaleString('zh-CN')}`,
        content: content,
        branch: 'main'
    };
    
    if (sha) {
        body.sha = sha;
    }
    
    // 提交到 GitHub
    const updateResponse = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    
    if (!updateResponse.ok) {
        const error = await updateResponse.json();
        throw new Error(error.message || '更新失败');
    }
    
    return await updateResponse.json();
}

// 页面加载时自动加载帖子
if (document.getElementById('postsList')) {
    loadPosts();
}