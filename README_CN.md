# ModelTrace Monitor

[English](README.md) · [配置与运行](CONFIGURATION.md) · [参与贡献](CONTRIBUTING.md)

独立运行的模型指纹监控工具：**定时检测 → 异常复测 → 发出警告**，由你决定是否调整账号。

不需要 fork Sub2API、不修改后端、不访问数据库，也不需要管理员密钥。只使用普通推理 API Key，调用兼容 OpenAI 的 **Responses API**。检测器不会暂停或禁用账号。

目前为实验性版本：本地模拟测试已通过，尚未验证真实账号识别准确率。警告表示指纹更接近另一个参考候选，不能当成已证明降级。

## 快速开始

需要 Linux/macOS 和 Node.js 22+，无需安装 npm 依赖。

```sh
git clone https://github.com/griffinzhai917/modeltrace-monitor.git
cd modeltrace-monitor
npm test
npm run check
```

示例默认关闭，`--check` 完全离线、不消耗模型额度。

把 `config.example.json` 复制到仓库之外的受控运行目录，配置 API 根地址、目标名称、模型和周期，通过环境变量注入普通 API Key，再将 `enabled` 设为 `true`：

```sh
node src/cli.mjs --check /path/to/runtime/config.json
node src/cli.mjs --once /path/to/runtime/config.json
node src/cli.mjs --run /path/to/runtime/config.json
```

每个目标先发 3 次请求；疑似异常时等待后再发 3 次。两轮均满足阈值、指向同一个其他模型时输出警告。`--once` 和 `--run` 会消耗上游额度，请求次数上限不等于 token 或金额上限。

## 如何检测 Sub2API 的某个账号

直接使用**原版 Sub2API**：

1. 给待检测账号配置专用分组，确保实际路由只会选择这个账号。
2. 使用该分组的普通 API Key，不启用会切到其他账号的回退路由。
3. 将该 Key 和 Sub2API 的 `/v1` 地址配置为一个检测目标。
4. 多个账号分别配置目标即可。

**检测器无法自行确认账号绑定。** 配置中的 `id` 只是本地名称，不会强制服务端选中某个账号。如果分组有多个账号、回退路由或模型映射，结果代表整个路由的表现。检测期间发生账号配置变更，外部检测器也无法感知。

## 警告在哪里

检测器标准输出提供 JSON 日志；`state_dir/history.json` 保存最近 200 条检测记录，包括目标、期望模型、疑似模型、两轮分数、时间和参考库版本。

- 复测仍异常：`warning`，目标继续使用。
- 指纹相似：`consistent`，不等于证明真实模型身份。
- 超时、限流、回答不完整等：`inconclusive`，不报模型替换警告。
- 参考库没有该模型：`unsupported_model`，不发送探测。

不保存密钥、原始提示词或回答。目前没有管理页面、邮件或手机推送。持续异常会在每个完成复测的周期留下警告。

## 范围与限制

当前只实现 Responses 协议，支持完整 SSE 或 JSON 响应；没有实现 Chat Completions 或原生 Anthropic Messages。参考库有 18 个候选模型，**不包含 `gpt-6.1-sol`**。

ModelTrace 对模型自行选择的数字序列做指纹比较。提示词、上下文、推理档位、模型版本和上游实现都可能改变分布；高分是有限候选集合内的相对分数，复测不能完全排除误判。独立 HTTP 探测也无法判断之前某次 WS 或长上下文业务请求由哪个模型完成。

Sub2API 升级无需给本项目合并后端补丁，但仍取决于标准接口、路由配置和参考库是否适用。

详细配置、运行锁、容器和停用方法见 [CONFIGURATION.md](CONFIGURATION.md)。Dockerfile 默认只做离线检查，未提供托管服务或预构建镜像。

## 来源与许可

指纹算法与参考库来自 [xqy2006/ModelTrace](https://github.com/xqy2006/ModelTrace)，固定提交及校验和见 `third_party/modeltrace/provenance.json`，原始 MIT 许可完整保留。

本项目独立实现标准 API 客户端、定时调度、复测和告警流程，不包含 Sub2API 后端源码，也不是两个上游项目的官方产品。

[MIT 许可](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md)
