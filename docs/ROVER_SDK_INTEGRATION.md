# Moonfall Rover SDK 集成契约

Jungle Explorer 不复制小车 SDK、定位服务或其调试前后端。它们继续由独立仓库维护：

- <https://github.com/Moonfall-Lab/moonfall-rover-control>

本仓库负责游戏规则、Agent、路径规划和 Game Server；独立 SDK 负责定时开环运动、停车和动作结束后的 AprilTag 最终定位。

## 调用边界

```text
Intent Card
  → Agent ActionPlan
  → MotionCommand[]
  → services/rover-bridge
  → SDK 字符串序列 F2 L F3
  → RoverSDK.execute(sequence)
  → MissionResult.position.cell
  → Game Server 结算最终格
```

Bridge 内部使用 SDK 已提供的 Python 调用形式：

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

## 第一阶段：仅运动接口

尚未启用 AprilTag 最终校正时，将 `ROVER_LOCALIZATION_MODE` 设为
`disabled`。Bridge 会调用 `RoverSDK.execute_motion()`，复用真实车测试过的
定时运动、UDP 保活、固件看门狗和急停逻辑，但不会访问定位服务。

运动结束后的任务状态是 `MOTION_COMPLETED`：

- `position` 和 `heading` 保持为空；
- Game Server 记录运动已经结束；
- 棋盘位置、回合数和格子结算保持不变；
- 待后续定位结果到达后，再由权威定位推进回合。

该接口只位于 Game Server 和 Rover Bridge，不在 `apps/web-board` 增加控制按钮。

## 运动序列转换

| Game Server 命令 | SDK Token |
| --- | --- |
| `{ action: "FORWARD", cells: 2 }` | `F2` |
| `{ action: "TURN_LEFT", degrees: 90 }` | `L` |
| `{ action: "TURN_RIGHT", degrees: 90 }` | `R` |

禁止输出 `F0`、负数、非整数格或任意角度旋转。

## 坐标转换

27 寸横屏的正确物理契约为 8 列 × 5 行，SDK 修正后应输出 `A-1` 至 `H-5`：

```text
SDK D-3 → Game Position { row: 2, col: 3 }
game.row = sdkNumber - 1
game.col = sdkLetterIndex
```

SDK `0.1.0` 当前仍硬编码 5 列 × 8 行和 `A-1..E-8`，与实物方向不一致。完整证据和 SDK 侧最小修改见 [`SDK_AUDIT.md`](SDK_AUDIT.md)。Bridge 提供两种显式映射：

- `landscape`：默认且用于最终实物，接受 `A-1..H-5`；
- `legacy_transposed`：只用于旧 SDK 迁移测试，接受 `A-1..E-8` 并转置。

注意：`legacy_transposed` 只能兼容已有测试数据，不能修复 27 寸横屏上的 Homography 分格方向。正式实物联调前必须先修改 SDK 的 rows/columns。

无论哪种映射，输入都必须满足 `position.in_grid === true` 且 `position.cell !== null`。

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

## Rover Bridge

`services/rover-bridge` 已实现：

1. 接收 Game Server 的 `MotionCommand[]`、`gameId` 和 `planId`；
2. 幂等转换成 SDK 字符串序列；
3. 在后台线程调用 `RoverSDK.execute`；
4. 将 SDK 格子和朝向转换为 Game 坐标；
5. 把最终位置和完整诊断遥测回调给 Game Server；
6. 提供任务查询和 `stop()` 急停端点；
7. 回调失败时保留任务结果，绝不重新执行小车任务。

安装和启动：

```bash
python3 -m venv .venv-rover
source .venv-rover/bin/activate
pip install -r services/rover-bridge/requirements.txt
pip install -e /path/to/moonfall-rover-control/backend_clients
set -a
source .env
set +a
uvicorn app.main:app --app-dir services/rover-bridge --host 0.0.0.0 --port 8200
```

然后导出 `.env.example` 中的 `ROVER_BRIDGE_*`、`ROVER_IP`、`LOCALIZER_URL` 和标定参数，以 `ROVER_MODE=hardware` 启动 Game Server。

Bridge API：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | SDK 安装和目标网格检查 |
| `POST` | `/missions` | 幂等创建并异步执行任务 |
| `GET` | `/missions/:planId` | 查询任务和最终遥测 |
| `POST` | `/missions/:planId/stop` | 请求 SDK 急停 |

仅运动请求示例：

```json
{
  "planId": "plan-1",
  "gameId": "game-1",
  "commands": [
    { "action": "FORWARD", "cells": 1 },
    { "action": "TURN_LEFT", "degrees": 90 }
  ],
  "rover": {
    "ip": "192.168.20.155",
    "port": 8888,
    "localization_mode": "disabled"
  }
}
```

SDK 横屏常量修正前，`ROVER_MODE=virtual` 仍是完整游戏联调的默认模式。
