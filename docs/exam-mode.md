# 考试模式 + Chrome 扩展

考试模式的原则是**预防，而不是抓人**：开启后桌宠先停止帮忙，分心网站和 AI 网站暂停访问，孩子全程都能看到考试模式开着，结束后孩子和家长看到的是同一份记录。

## 开启后会发生什么

| 位置 | 变化 |
| --- | --- |
| 家长页面 | 显示 **ON**、剩余时间，以及实时的三个数字 |
| 桌宠 | 换成"守门"动画，面板顶部出现红色提示，旁边显示考试倒计时；聊天、发图片、截图、专注计时都暂停 |
| Chrome 扩展 | 图标上出现红色 **EXAM**；打开名单里的网站会显示"这个网站在考试期间暂停"的页面 |
| server | 考试期间直接拒绝回答问题、拆解任务，所以就算绕过桌宠也拿不到答案 |

**只记录三个数字**：打开被暂停网站的次数、切换标签页的次数、离开 Chrome 的次数。
**不记录**：网页内容、访问了哪些网站、屏幕截图、摄像头或麦克风。

时间到了会自动结束。即使扩展连不上 server，到了结束时间也会自动恢复所有网站。

---

## 安装 Chrome 扩展（👤 你来操作，大约 3 分钟）

1. 打开 Chrome，在地址栏输入 `chrome://extensions` 并回车
2. 打开右上角的 **开发者模式 (Developer mode)**
3. 点 **加载已解压的扩展程序 (Load unpacked)**，选择 `~/Desktop/study-buddy-pet/extension` 文件夹
4. 扩展会自动打开设置页（没打开的话，点扩展卡片上的 **详细信息 → 扩展程序选项**），填两项：
   - **Server address**：和 `app/config.local.json` 里的 `serverUrl` 一样，例如 `https://study-buddy-server-u0fn.onrender.com`
   - **Device token**：和 `app/config.local.json` 里的 `deviceToken` 一样
5. 点 **Save and test**，显示 **Connected** 就好了
6. 建议点 Chrome 工具栏的拼图图标，把 **Study Buddy Exam Mode** 固定在工具栏上，这样能看到 EXAM 标记

> 用本地 server 测试的话：地址填 `http://localhost:3000`，token 留空。

## 更新云端 server（👤 你来操作）

这次 server 也改了，需要推送到 GitHub：GitHub Desktop → Summary 写 `Add exam mode` → **Commit to main** → **Push origin**。Render 会自动部署，大约 2 分钟。

桌宠的代码也改了，需要重启桌宠（Ctrl + C，再 `npm start`）。

## 测试步骤

1. 打开家长页面 → **Exam mode** → 选 **15 minutes** → **Start exam mode**
2. 最多等 30 秒：Chrome 扩展图标出现 **EXAM**，桌宠变成守门动画，面板出现红色提示
3. 在 Chrome 打开 `youtube.com` 或 `chatgpt.com`，应该看到暂停页面
4. 切换几次标签页，或者切到别的 App 再回来
5. 回到家长页面，等最多 15 秒，三个数字应该会增加
6. 点 **End exam now**：网站恢复，桌宠庆祝并告诉孩子这次的记录，家长页面出现在 **Past exams** 里

## 编辑暂停的网站

家长页面 → Exam mode → **Sites paused during exams**。每行写一个网站，可以直接粘贴完整网址，会自动只保留域名。子域名会一起暂停（填 `youtube.com` 也会暂停 `m.youtube.com`）。改完点 **Save list**，下一次考试开始时生效。

默认名单包括分心网站（YouTube、TikTok、Instagram、Roblox、Netflix、Discord、Reddit 等）和 AI / 找答案网站（ChatGPT、Claude、Gemini、Copilot、Perplexity、Photomath、Brainly、Chegg 等）。

## 局限（写作业时可以引用）

- 只管得到装了扩展的 Chrome，管不到其他浏览器、手机或另一台电脑。学校正式考试一般会用专门的锁定浏览器
- 孩子可以在 `chrome://extensions` 里关掉扩展。正式产品需要学校或家长用 Chrome 管理策略强制安装
- 切换标签页的次数可能包含正常操作（比如切到考试需要的资料页），所以只作为参考，不作为"作弊"的证据
