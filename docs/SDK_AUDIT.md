# Moonfall Rover SDK 核对报告

核对对象：<https://github.com/Moonfall-Lab/moonfall-rover-control>

核对提交：`9fc493c`（SDK `main`）

SDK 版本：`moonfall-rover-sdk 0.1.0`

## 已确认能力

- Python 3.11+，核心 SDK 无第三方运行时依赖；
- `RoverSDK.execute("F2 L F3")` 同步执行完整任务；
- 支持 `F<n>`、`L`、`R` 及对应中文动作；
- 每个动作之间停车稳定，转角固定为 90°；
- UDP 端口默认 8888，上位机按 100ms 周期发送轮速；
- ESP32 侧约 300ms 看门狗停车；
- 动作结束后只接受 `finished_at_ms` 之后的新定位帧；
- 默认采集 3 个不同帧，对 X/Y 取中值、对角度取圆均值；
- `stop()` 可中断正在运行的任务；
- 同一个 `RoverSDK` 实例通过执行锁避免并发运动；
- 测试控制端为 R0/R1 保存独立运行器，可并发测试两台车。

核对时实际执行：

- 12 个 Python SDK、动作解析、急停和控制端测试：全部通过；
- 2 个 Node.js Homography/定位数学测试：全部通过。

## 返回边界

成功结果包含：

```text
sequence
action_count
movement_duration_sec
position.cell
position.in_grid
position.x_cm / y_cm
position.heading_deg
position.rover_tag_id
position.detected_at_ms
position.sample_count
```

关键异常：

- `LocalizationTimeout`：车可能已经运动完成，但最终定位没有取得；
- `MissionCancelled`：任务被 `stop()` 或外部停止事件中断；
- 其他网络、解析或驱动异常：SDK 会先停车再继续抛出。

因此 Game Server 不能在 SDK 异常时使用计划目标猜测位置。

## 阻断项：SDK 当前网格方向与实物不一致

SDK 当前 `localizer/position.mjs` 以及 Python `LocatorClient` 都硬编码：

```text
COLUMNS = 5
ROWS = 8
fieldWidth = 5 × cellCm = 33.4 cm
fieldHeight = 8 × cellCm = 53.44 cm
cell = A-1 .. E-8
```

但已确认的 27 寸横屏实体地图是：

```text
8 columns × 5 rows
fieldWidth = 8 × 6.68 = 53.44 cm
fieldHeight = 5 × 6.68 = 33.4 cm
expected cell = A-1 .. H-5
```

这是 Homography 建立世界坐标时的方向差异，不能只在 Game Server 收到 `C-4` 后做转置来修复。因为在输出格子前，SDK 已经把屏幕水平方向切成 5 份、垂直方向切成 8 份。

## SDK 仓库需要的最小修正

在 SDK 仓库单独提交：

1. `localizer/position.mjs` 改为 `COLUMNS=8, ROWS=5`；
2. Python `LocatorClient._merge_samples` 改为 `0 <= column < 8`、`0 <= row < 5`；
3. README 图和有效格范围改为 `A-1..H-5`；
4. 定位测试锚点世界尺寸改为横向 53.44 cm、纵向 33.4 cm；
5. 增加 `A-1`、`H-5`、右边界和下边界测试；
6. 最好让 rows/columns 成为显式配置，避免再次硬编码。

完成这项修正前，不应在 27 寸横屏上宣称格子定位已经集成完成。

## 非阻断改进建议

- 给 `MissionResult` 增加调用方提供的 `mission_id`，或由 Bridge 维护幂等；
- 将定位 `rows/columns` 放入 API 响应，便于调用方验证版本；
- 为定位结果增加 calibration id 和固定 Tag 最后更新时间；
- 显式区分“运动失败”和“运动完成但定位失败”；
- 每台车保存独立 `MotionConfig`，不要共享实测参数；
- 在真实屏幕四角进行定位误差测试，并输出格中心偏差。

Jungle Explorer 侧通过 `services/rover-bridge` 隔离这些差异。Bridge 支持修正后的横屏 `A-H/1-5`，也保留旧版转置解析用于 SDK 迁移测试。
