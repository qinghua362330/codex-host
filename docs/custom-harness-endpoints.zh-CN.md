# 自定义 Harness Endpoint 配置（设计草案）

本功能为每个 Harness 独立配置 endpoint、凭据引用和默认模型，同时保持实际 Turn、工具、审批、历史和命令调用由原生 Harness 执行。

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
enabled = true
command = "chatglm-harness"
default_model = "glm-4.5"

[harnesses.chatglm.endpoint]
base_url = "https://gateway.example.com/glm"
api_key_env = "CHATGLM_API_KEY"
```

Adapter 必须将 endpoint 配置转换为目标 Harness 原生支持的启动参数或环境变量；Host 不得自行拼接模型 API 请求。

## 能力来源

模型目录中的工具、推理、图片、原生命令等能力必须标记为 `native`、`adapter` 或 `unsupported`。只有目标 Harness 原生声明或 Adapter 明确实现的能力才可暴露。

## 实现顺序

1. 添加配置 schema、加载和脱敏读取 API。
2. 将配置注入 Adapter inspection/session factory。
3. 为 Gemini 和 ChatGLM 增加原生 Adapter。
4. Renderer 增加 endpoint/model 设置页。
5. 为 resume、endpoint 隔离、密钥脱敏和能力目录增加测试。
