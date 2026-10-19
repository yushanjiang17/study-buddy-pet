# 把 Study Buddy 部署到云端（简化版：一个家长账号）

部署完成后：

```
桌宠（孩子的 Mac） ──HTTPS + 设备密钥──▶  Render 上的 server  ──▶  Claude API
家长（手机/任何电脑）──HTTPS + 登录────▶        │
                                               ▼
                                         Neon 数据库（任务、积分、设置、每天的统计）
```

- **Render** 运行 server（免费版）。15 分钟没人访问会休眠，再次访问要等约 1 分钟才能唤醒。桌宠每分钟会访问一次 server，所以只要桌宠开着，server 就不会休眠。
- **Neon** 存数据（免费，不需要信用卡）。之所以要另外用一个数据库，是因为 Render 免费版的硬盘每次重启都会清空，而 Render 自带的免费数据库 30 天后就过期。
- 云端存的内容和本地版一样：任务、积分、设置、每天的计数和安全提醒的类别。**不存**孩子说的话和发的图片。

> 标 👤 的步骤需要你自己操作（注册账号、复制密钥这类事我不能代做）。密钥和密码**不要**发到聊天里。

---

## 第 0 步：准备

👤 需要：
- 一个 GitHub 账号
- 已经在用的 Anthropic API key（就是你本地 `server/.env` 里那个）

---

## 第 1 步：把代码放到 GitHub（私有仓库）

👤 **方法 A（推荐，不用敲命令）：GitHub Desktop**
1. 下载安装 GitHub Desktop（desktop.github.com），用你的 GitHub 账号登录
2. 菜单 **File → Add Local Repository…**，选择 `~/Desktop/study-buddy-pet`
3. 提示"这不是 git 仓库"时，点 **create a repository**，然后点 **Create Repository**
4. 左侧的文件列表里，**确认没有** `.env`、`node_modules`、`config.local.json`（这些已经在 `.gitignore` 里排除了）
5. 左下角 Summary 写 `Study Buddy MVP`，点 **Commit to main**
6. 点 **Publish repository**，**勾选 Keep this code private**，再点 Publish

👤 **方法 B：用终端**（如果你已经装了 `gh` 并登录过）
```bash
cd ~/Desktop/study-buddy-pet
git init && git add . && git status    # 检查列表里没有 .env / node_modules / config.local.json
git commit -m "Study Buddy MVP"
gh repo create study-buddy-pet --private --source=. --push
```

> 用私有仓库是因为角色素材来自别人的作品（课程演示用），不应该公开。

---

## 第 2 步：建 Neon 数据库

👤
1. 打开 neon.tech，用 GitHub 账号注册或登录
2. **Create project**：名字随意（例如 `study-buddy`），Region 选 **AWS US West (Oregon)**（离 Render 默认的机房近），Postgres 版本保持默认
3. 创建好后，在项目首页点 **Connect**，复制 **Connection string**（以 `postgresql://` 开头的一长串）
4. 先把它放在一个安全的地方，第 3 步要用

不需要手动建表，server 第一次启动时会自动创建。

---

## 第 3 步：在 Render 上部署

👤
1. 打开 render.com，用 GitHub 账号注册或登录
2. 右上角 **New → Blueprint**
3. 连接 GitHub，选择 `study-buddy-pet` 仓库（如果看不到，点 *Configure GitHub App*，授权 Render 访问这个仓库）
4. Render 会读取仓库里的 `render.yaml`，并请你填写 4 个值：

   | 名称 | 填什么 |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | 你的 Claude API key |
   | `DATABASE_URL` | 第 2 步复制的 Neon connection string |
   | `PARENT_EMAIL` | 家长登录用的邮箱 |
   | `PARENT_PASSWORD` | 家长登录密码，**至少 8 位**，不要和其他网站重复 |

   `DEVICE_TOKEN` 和 `SESSION_SECRET` 会自动生成，不用填。
5. 点 **Apply / Deploy Blueprint**，等几分钟
6. 点进服务 `study-buddy-server` → **Logs**，看到这几行就说明成功了：
   ```
   Study Buddy server running on 0.0.0.0:10000 (cloud mode)
   Storage: postgres
   Pet device token: required
   ```
7. 页面顶部有服务的网址，形如 `https://study-buddy-server-xxxx.onrender.com`，复制下来

---

## 第 4 步：让桌宠连接云端

👤
1. 在 Render 服务页面点 **Environment**，找到 `DEVICE_TOKEN`，点眼睛图标显示，然后复制
2. 在终端里：
   ```bash
   cd ~/Desktop/study-buddy-pet/app
   cp config.local.example.json config.local.json
   open -e config.local.json
   ```
3. 把两个值换成你的，保存：
   ```json
   {
     "serverUrl": "https://study-buddy-server-xxxx.onrender.com",
     "deviceToken": "刚才复制的 DEVICE_TOKEN"
   }
   ```
4. 重启桌宠（运行桌宠的终端里按 Ctrl + C，再 `npm start`）
5. 本地的 server 现在可以停掉了（运行 server 的终端里按 Ctrl + C）

> `config.local.json` 已经被 `.gitignore` 排除，不会上传到 GitHub。

---

## 第 5 步：家长登录

👤 在手机或任意电脑的浏览器里打开：
```
https://study-buddy-server-xxxx.onrender.com/parent
```
输入第 3 步设置的邮箱和密码。登录会保持 7 天。

也可以右键桌宠 → **Parent page…**，会直接打开这个云端网址。

---

## 以后改代码怎么更新

改完代码后 commit 并 push 到 GitHub（GitHub Desktop：写 Summary → Commit → **Push origin**）。Render 会自动重新部署，大约 2 到 3 分钟。

只改桌宠（`app/` 里的文件）的话不需要部署，重启桌宠就行。

---

## 想切回本地版

把 `app/config.local.json` 改名或删掉，再启动本地 server（`cd server && npm start`）。本地版的数据还在 `server/data/db.json` 里。注意：本地和云端的数据是**分开的**，不会互相同步。

---

## 常见问题

| 现象 | 原因 / 解决 |
| --- | --- |
| 桌宠说 "The castle doesn't recognize me" | `deviceToken` 复制错了，重新从 Render 的 Environment 复制 |
| 桌宠一开始说连不上，过一会儿就好了 | server 在休眠，正在唤醒（约 1 分钟），桌宠会自动重试 |
| 家长页面打开要等很久 | 桌宠没开时 server 会休眠，第一次打开要等约 1 分钟 |
| 家长登录提示 "Sign-in is turned off" | `PARENT_PASSWORD` 没设或少于 8 位：在 Render 的 Environment 里修改，保存后会自动重启 |
| Render Logs 显示 `DEVICE_TOKEN ... Refusing to start` | Environment 里少了 `DEVICE_TOKEN`：点 Add，值随便填一串 30 位以上的乱码，然后把同样的值填进 `config.local.json` |
| Logs 里有数据库连接错误 | `DATABASE_URL` 粘贴不完整，或 Neon 项目被暂停了：在 Neon 控制台确认项目是 Active |
| 一直输错密码被锁 | 15 分钟后自动解锁 |

## 安全说明（写作业时可以引用）

- 孩子的设备用**设备密钥**（Bearer token）访问 server，没有密钥的请求会被拒绝
- 家长用邮箱 + 密码登录，登录状态保存在签名过的 HttpOnly、Secure cookie 里；连续输错 8 次会锁 15 分钟；修改数据的请求必须来自家长页面本身
- API key、数据库地址、密码都只存在 Render 的环境变量里，不在代码和 GitHub 里
- 全程 HTTPS（Render 自动提供）
- 局限：只有一个家长账号；正式产品还需要多账户、可验证的家长同意（COPPA）、数据删除功能等
