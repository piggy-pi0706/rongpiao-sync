# 冲呀蓉漂！云端同步后端

让电脑和手机上的工作台自动同步数据（课文、计时、结构化题、视频列表等）。
零第三方依赖，仅用 Node 内置模块；服务端把全量状态存进 `data.json`。

## 目录结构
```
server.js          # 后端：托管前端 + 提供 /api/state 读写
package.json       # 启动脚本（无依赖）
render.yaml        # Render 一键部署配置
public/index.html  # 工作台前端（已内置同步逻辑）
```

## 本地运行 / 自测
```bash
cd rongpiao-sync
node server.js
# 浏览器打开 http://localhost:3000
```
前端打开后会自动从 `/api/state` 拉取并合并，之后每次改动都会在 0.8 秒后自动推送到服务端。
顶部「未同步 / 已同步 / 离线」状态条可点击立即同步。

## 部署到 Render（免费）
> 前提：一个 GitHub 账号 + 一个 Render 账号（均免费、无需信用卡）。

1. 在 GitHub 新建一个**空仓库**（如 `rongpiao-sync`）。
2. 把本目录全部文件推上去：
   ```bash
   git init
   git add .
   git commit -m "init"
   git branch -M main
   git remote add origin <你的仓库地址>
   git push -u origin main
   ```
3. 打开 https://dashboard.render.com → **New → Blueprint** → 连接该 GitHub 仓库。
4. Render 会读取 `render.yaml`，自动创建名为 `chongya-rongpiao` 的 Web 服务（免费 plan）。
5. 点 **Deploy**，约 1 分钟后得到一个 `https://chongya-rongpiao-xxx.onrender.com` 链接。
6. **电脑和手机都打开这个链接**，即自动跨设备同步。

## 重要须知（务必读）
- **两端用同一个链接**：同步靠这个后端链接中转，请电脑、手机都只用 Render 给的这一个 URL，
  不要再各自打开旧的本地文件 / 旧的 CloudStudio 静态链接（那些不会同步）。
- **录音音频不同步**：为防止载荷过大，录音的音频(base64)不同步，只同步录音的标题/时长等元数据。
  录音文件跨设备请用工作台自带的「导出 / 导入」搬运。
- **视频文件不同步**：试讲视频的 blob 存在浏览器 IndexedDB（设备本地），只同步视频列表元数据；
  播放仍在录制它的那台设备上。视频跨设备同样用「导出 / 导入」。
- **Render 免费实例磁盘是临时的**：服务端 `data.json` 可能在实例休眠/重启后清空。
  但因为每台设备的浏览器 localStorage 都保留着完整数据，下次任意一端同步时会自动把本地数据
  「重新种回」服务端，不会真正丢数据。最稳妥仍是定期点右上角「导出」留底。
- 若想要服务端持久保存（不依赖设备回填），可在 Render 加一个 **Render Disk**（付费），
  或把存储换成 Upstash Redis（免费层，需自建账号和密钥）。按需升级即可。

## 数据接口
- `GET /api/state` → `{ state, version, updatedAt }`（首次为空：`{state:null,...}`）
- `POST /api/state` → body `{ client, state }`，返回 `{ ok, version, updatedAt }`
- 冲突处理（同字段两端都改）在前端 `mergeState` 完成：按 id 并集、学习时长按日期累加、其余取非空。

## AI 语义评判（可选，需密钥）
工作台「结构化训练」里每段作答录音可点「AI 评判」，调用大模型按例题模板语义级打分。
因为浏览器直连大模型会有 CORS 限制、且密钥不应写进前端，这里用**服务端代理** `/api/llm`：
密钥只存在服务端环境变量，前端把「题目 + 答题结构 + 参考答案 + 考生文字稿」发给同源代理，服务端加密钥转发给大模型。

在 Render 部署的后台 → 该服务 → **Environment** 里添加环境变量：
- `LLM_API_KEY`（必填）：你的大模型 API Key（如 DeepSeek、OpenAI 等）。
- `LLM_BASE_URL`（可选）：默认 `https://api.deepseek.com/v1`；用 OpenAI 就填 `https://api.openai.com/v1`。
- `LLM_MODEL`（可选）：默认 `deepseek-chat`；OpenAI 可填 `gpt-4o-mini` 等。

> 不做这步也能正常用工作台，**只是「AI 评判」会提示需在 Render 部署版并配置密钥**。
> 当前线上 CloudStudio 静态链接没有后端，因此 AI 评判/跨设备同步都不可用，需走 Render 部署版。

### 本地自测 /api/llm（无密钥时返回友好报错）
```bash
LLM_API_KEY=sk-xxx node server.js
curl -s -X POST http://localhost:3000/api/llm -H "Content-Type: application/json" \
  -d '{"system":"你是评委","user":"请评判：...","base":"https://api.deepseek.com/v1","model":"deepseek-chat"}'
```

