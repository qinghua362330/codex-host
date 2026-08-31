# 自定义 Harness Endpoint 配置

本功能为每个 Harness 独立配置 endpoint、凭据引用和默认模型，同时保持实际 Turn、工具、审批、历史和命令调用由原生 Harness 执行。

## 当前原生入口

### Gemini CLI

Gemini CLI 当前提供 ACP 模式（`gemini --acp`），通过 stdio 上的 JSON-RPC 进行 `initialize`、`newSession`、`loadSession`、`prompt`、`cancel` 和模型切换。Adapter 应使用该 ACP 通道，而不是解析普通终端文本。Gemini 的 endpoint 可通过 `GOOGLE_GEMINI_BASE_URL` 注入，模型可通过 `GEMINI_MODEL` 或 ACP 会话模型设置注入。

### ChatGLM

ChatGLM 目前没有在本项目中确认到由 Z.ai/智谱官方维护、协议稳定且可用于 CodexHost 原生会话投影的独立 Harness。ChatGLM Adapter 必须绑定一个明确的本地 Harness 命令和协议；在协议确认前不得把 ChatGLM API 直接包装成“原生 Harness”。

## 配置边界

- `harnessId` 标识执行程序，不等同于模型或 Provider。
- endpoint 配置只由对应 Adapter 消费，不进入 shared/renderer 的原生协议。
- API Key 只允许通过环境变量或系统密钥引用注入，禁止写入 Thread、日志或 Renderer 响应。
- endpoint、模型和 Harness 版本在 Native Session 创建时绑定；变更 endpoint 必须创建新 Native Session。

## 推荐配置

```toml
[harnesses.gemini]
enabled = true
command = "gemini"
default_model = "gemini-2.5-pro"

[harnesses.gemini.endpoint]
base_url = "https://gateway.example.com/gemini"
api_key_env = "GEMINI_API_KEY"

[harnesses.gemini.models]
allow = ["gemini-2.5-pro", "gemini-2.5-flash"]

[harnesses.chatglm]
enabled = false
command = "chatglm-harness"
default_model = "glm-4.5"

[harnesses.chatglm.endpoint]
base_url = "https://gateway.example.com/glm"
api_key_env = "CHATGLM_API_KEY"
```

Adapter 必须将 endpoint 配置转换为目标 Harness 原生支持的启动参数或环境变量；Host 不得自行拼接模型 API 请求。
