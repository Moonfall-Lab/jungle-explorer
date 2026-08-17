# Moonfall Rover SDK 集成契约

Jungle Explorer 不复制小车 SDK、定位服务或其调试前后端。它们继续由独立仓库维护：

- <https://github.com/Moonfall-Lab/moonfall-rover-control>

本仓库负责游戏规则、Agent、路径规划和 Game Server；独立 SDK 负责定时开环运动、停车和动作结束后的 AprilTag 最终定位。

## 调用边界

```text
Intent Card
  → Agent ActionPlan
  → MotionCommand[]
  → SDK 字符串序列 F2 L F3
  → RoverSDK.execute(sequence)
  → MissionResult.position.cell
  → Game Server 结算最终格
```

SDK 已提供 Python 调用形式：

```python
from rover_agent import RoverSDK

with RoverSDK(
    rover_ip,
    localizer_url="http://127.0.0.1:8098",
    rover_tag_id=0,
) as rover:
    result = rover.execute("F2 L F3")

print(result.position.cell)
```

SDK 的测试控制前端和定位前端用于硬件调试，不是 Jungle Explorer 玩家界面，也不应合并到本仓库。

## 运动序列转换

| Game Server 命令 | SDK Token |
| --- | --- |
| `{ action: "FORWARD", cells: 2 }` | `F2` |
| `{ action: "TURN_LEFT", degrees: 90 }` | `L` |
| `{ action: "TURN_RIGHT", degrees: 90 }` | `R` |

禁止输出 `F0`、负数、非整数格或任意角度旋转。

## 坐标转换

SDK 的物理棋盘为 5 列 × 8 行，格子字符串格式为 `A-1` 至 `E-8`。本游戏状态使用 5 行 × 8 列的零基坐标，因此采用转置映射：

```text
SDK C-4
letterIndex(C) = 2
number(4) - 1 = 3
→ Game Position { row: 2, col: 3 }
```

通式：

```text
game.row = sdkLetter.charCodeAt(0) - charCode('A')
game.col = sdkNumber - 1
```

输入必须满足：

- SDK 字母为 `A..E`；
- SDK 数字为 `1..8`；
- `position.in_grid === true`；
- `position.cell !== null`。

朝向角度必须通过现场标定转换为 `NORTH / EAST / SOUTH / WEST`，不能仅凭未经确认的角度符号假设方向。

## 返回结果

SDK `MissionResult` 包含：

```json
{
  "sequence": "F2 L F3",
  "action_count": 3,
  "movement_duration_sec": 4.12,
  "position": {
    "cell": "C-4",
    "in_grid": true,
    "x_cm": 16.7,
    "y_cm": 23.38,
    "heading_deg": 90.0,
    "rover_tag_id": 0,
    "detected_at_ms": 1780000000000,
    "sample_count": 3
  }
}
```

Game Server 的适配器只用 `cell` 更新逻辑位置；厘米坐标、角度、采样数和时间作为诊断遥测保存。

## 任务一致性

独立 SDK 当前接受运动序列，没有 Game Server 的 `planId` 语义。因此集成适配器必须负责：

- 为每个计划记录唯一 `planId`；
- 一个 `planId` 最多调用一次 `execute`；
- SDK 返回后，将结果与对应计划一起提交；
- Server 已结算的 `planId` 再次出现时直接忽略；
- 进程重启时不得自动重放状态未知的运动计划；
- 定位失败时保留计划为“运动完成、等待人工重扫”，不能按计划目标猜测位置。

## 异常处理

| SDK 状态 | Game Server 行为 |
| --- | --- |
| 正常返回有效格 | 结算最终格 |
| `LocalizationTimeout` | 不结算，提示重扫或主持人纠错 |
| `MissionCancelled` | 不结算，记录急停 |
| `in_grid: false` | 不结算，进入场外恢复流程 |
| 网络或 UDP 故障 | 停车、记录失败，不自动重试整段序列 |
| 实际格与计划目标不同 | 采用实际格并记录偏差 |

## 当前接入任务

本仓库下一步应增加一个 Python Rover Bridge 或本地 sidecar：

1. 接收 Game Server 的 `MotionCommand[]` 和 `planId`；
2. 转换成 SDK 字符串序列；
3. 调用 `RoverSDK.execute`；
4. 将 SDK 格子转换为 Game `Position`；
5. 向 Game Server 提交最终位置和诊断遥测；
6. 暴露 `stop()` 急停接口。

在该 Bridge 完成前，`ROVER_MODE=virtual` 继续用于纯软件联调。
