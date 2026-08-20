# Moonfall Rover SDK 横屏 5×8 地图调整说明

交接对象：简泽宇

目标仓库：<https://github.com/Moonfall-Lab/moonfall-rover-control>

核对基线：`main@9fc493c`

建议版本：`moonfall-rover-sdk 0.2.0`

## 1. 调整目标

把 Rover SDK 的定位坐标系从当前的：

```text
5 列 × 8 行
33.40 cm 宽 × 53.44 cm 高
有效格子 A-1 .. E-8
```

调整为 27 寸横屏实体地图实际使用的：

```text
8 列 × 5 行
53.44 cm 宽 × 33.40 cm 高
有效格子 A-1 .. H-5
```

逻辑约定保持不变：

- 原点位于棋盘左上角；
- X 轴向右；
- Y 轴向下；
- 字母表示列：`A..H`；
- 数字表示行：`1..5`；
- 每格目标边长为 `6.68 cm`；
- 固定 Tag 仍为：5 左上、4 右上、6 左下、7 右下；
- 车顶 Tag 上边继续与车头方向对齐。

## 2. 为什么必须在 SDK 内修改

当前 SDK 在建立 Homography 世界坐标时使用：

```text
fieldWidth = 5 × 6.68 = 33.40 cm
fieldHeight = 8 × 6.68 = 53.44 cm
```

但实际显示器上的棋盘是：

```text
fieldWidth = 8 × 6.68 = 53.44 cm
fieldHeight = 5 × 6.68 = 33.40 cm
```

如果只在 Jungle Explorer 收到 `C-4` 后转置坐标，仍然无法修复定位。因为 SDK 在输出格子前已经把屏幕水平方向切成 5 份、垂直方向切成 8 份，错误发生在 Homography 和分格阶段。

最终实体版本不能继续使用旧版 `A-1..E-8` 转置方案。

## 3. 已确认的实体尺寸

| 项目 | 尺寸 |
| --- | ---: |
| 显示器物理宽度 | 59.6 cm |
| 显示器物理高度 | 33.4 cm |
| 网格 | 5 行 × 8 列 |
| 单格目标边长 | 6.68 cm |
| 棋盘宽度 | 53.44 cm |
| 棋盘高度 | 33.40 cm |
| 左右理论留边 | 各 3.08 cm |
| 小车宽度 | 5–6 cm |

`tagGapCm` 仍应表示“固定 Tag 内边到棋盘边缘的实测距离”，不能直接把 3.08 cm 显示器留边当成 Tag Gap。最终数值应在 Tag 安装完成后用尺测量。

## 4. 必须修改的文件

### 4.1 `localizer/position.mjs`

将：

```js
export const COLUMNS = 5;
export const ROWS = 8;
```

改为：

```js
export const COLUMNS = 8;
export const ROWS = 5;
```

修改后现有计算会自动得到：

```js
fieldWidth = 8 * 6.68;  // 53.44 cm
fieldHeight = 5 * 6.68; // 33.40 cm
```

`locateRover()` 的格子格式不需要改写；在新边界下会自然输出 `A-1..H-5`。

建议顺便让 `createCalibration()` 返回 `rows` 和 `columns`，便于 API 调用方核对版本：

```js
return {
  matrix: homography(pixels, world),
  cellCm,
  rows: ROWS,
  columns: COLUMNS,
  fieldWidth,
  fieldHeight,
  tagGapCm,
};
```

### 4.2 `backend_clients/rover_agent/sdk.py`

当前 `LocatorClient._merge_samples()` 仍有第二份硬编码：

```python
in_grid = 0 <= column < 5 and 0 <= row < 8
```

至少改为：

```python
in_grid = 0 <= column < 8 and 0 <= row < 5
```

更推荐避免再次散落魔法数字，在 `LocatorClient` 中显式保存地图尺寸：

```python
class LocatorClient:
    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8098",
        rover_tag_id: int = 0,
        tag_gap_cm: float = 0,
        cell_cm: float = 6.68,
        columns: int = 8,
        rows: int = 5,
    ) -> None:
        self.columns = columns
        self.rows = rows
```

然后使用：

```python
in_grid = (
    0 <= column < self.columns
    and 0 <= row < self.rows
)
```

建议 `LocatorClient.read()` 同时把尺寸传给定位 API：

```python
query = urllib.parse.urlencode({
    "roverId": self.rover_tag_id,
    "tagGapCm": self.tag_gap_cm,
    "cellCm": self.cell_cm,
    "columns": self.columns,
    "rows": self.rows,
    "maxAgeMs": max_age_ms,
})
```

如果这一轮不准备让服务端尺寸可配置，也可以先固定为 8×5，但 JavaScript 与 Python 两侧必须一致。

### 4.3 `localizer/public/app.js`

调试定位页面包含第三份常量。将：

```js
const CELL_CM = 6.68;
const COLUMNS = 5;
const ROWS = 8;
```

改为：

```js
const CELL_CM = 6.68;
const COLUMNS = 8;
const ROWS = 5;
```

同时把标定成功文案从笼统的 `5 × 8` 改成不易混淆的：

```text
8 列 × 5 行坐标系已锁定
```

注意检查该页面显示的 `FIELD_WIDTH` 应为 `53.44`，`FIELD_HEIGHT` 应为 `33.40`。

长期建议让页面从 `/api/info` 读取 `rows / columns / cellCm`，不要继续维护第四套前端配置。

### 4.4 `localizer/public/index.html`

将页面说明：

```text
格盘：5 列 × 8 行，每格 6.68 cm
```

改成：

```text
格盘：8 列 × 5 行，每格约 6.68 cm
有效格：A-1 至 H-5
```

### 4.5 文档

同步修改：

- 根目录 `README.md`；
- `localizer/README.md`；
- 所有场地图示；
- 所有 `A-1..E-8`、5列×8行、33.4×53.44 cm 的旧说明。

推荐统一写成：

```text
逻辑地图为 5 行 × 8 列；SDK 格子命名为 A-1..H-5。
字母 A..H 对应从左到右的 8 列，数字 1..5 对应从上到下的 5 行。
```

## 5. 必须更新的 JavaScript 定位测试

文件：`localizer/test-position.mjs`

### 5.1 更新四角锚点世界尺寸

Tag 尺寸为 7 cm、Gap 为 0 时，Tag 中心相对棋盘边缘偏移 3.5 cm。

横屏棋盘四个 Tag 中心的世界坐标应为：

```js
const anchors = [
  { id: 5, center: toPixel({ x: -3.5,  y: -3.5 }) },
  { id: 4, center: toPixel({ x: 56.94, y: -3.5 }) },
  { id: 7, center: toPixel({ x: 56.94, y: 36.9 }) },
  { id: 6, center: toPixel({ x: -3.5,  y: 36.9 }) },
];
```

其中：

```text
56.94 = 53.44 + 3.5
36.90 = 33.40 + 3.5
```

### 5.2 增加能真正识别方向错误的用例

原来的 `C-4` 在两种方向中都可能仍是合法格，不能证明 rows/columns 已经修正。至少加入以下测试：

```js
test("maps the first landscape cell", () => {
  // A-1 center: x=3.34, y=3.34
});

test("maps the last landscape cell", () => {
  // H-5 center: x=50.10, y=30.06
});

test("rejects the right landscape boundary", () => {
  // x=53.44 is outside the board
});

test("rejects the bottom landscape boundary", () => {
  // y=33.40 is outside the board
});
```

必须断言：

```text
(3.34, 3.34)   → A-1
(50.10, 30.06) → H-5
x < 0          → out of grid
y < 0          → out of grid
x >= 53.44     → out of grid
y >= 33.40     → out of grid
```

建议再保留一个内部格，例如：

```text
(23.38, 16.70) → D-3
```

## 6. 必须更新的 Python SDK 测试

文件：`backend_clients/tests/test_sdk.py`

在 `_merge_samples()` 测试中加入横屏边界值，特别是旧版无法表示的 `H-5`：

```python
self.values = iter([
    {
        "available": True,
        "detectedAt": 101,
        "xCm": 50.0,
        "yCm": 30.0,
        "headingDeg": 0,
    },
    {
        "available": True,
        "detectedAt": 102,
        "xCm": 50.2,
        "yCm": 30.1,
        "headingDeg": 1,
    },
    {
        "available": True,
        "detectedAt": 103,
        "xCm": 50.1,
        "yCm": 30.06,
        "headingDeg": -1,
    },
])
```

合并后必须断言：

```python
self.assertEqual(position.cell, "H-5")
self.assertTrue(position.in_grid)
self.assertEqual(position.sample_count, 3)
```

另外加入右边界和下边界测试，确保不会生成 `I-*` 或 `*-6`。

## 7. API 建议

为了让 Jungle Explorer 启动时能够拒绝错误版本，建议 `/api/info` 或 `/api/location` 返回：

```json
{
  "grid": {
    "columns": 8,
    "rows": 5,
    "cellCm": 6.68,
    "fieldWidthCm": 53.44,
    "fieldHeightCm": 33.4,
    "cellFormat": "A-1..H-5"
  }
}
```

Jungle Explorer 的 Rover Bridge 会以以下方式转换：

```text
SDK D-3
→ letter D = column 3
→ number 3 = row 2
→ Game Position { row: 2, col: 3 }
```

SDK 修正后，Bridge 使用 `SDK_GRID_MAPPING=landscape`。`legacy_transposed` 只用于迁移测试，不用于最终实物。

## 8. 实物标定与验收

代码测试通过后，需要在最终 27 寸显示器上执行：

1. 浏览器真正全屏，确认地图 5 行×8列且格子为正方形；
2. 实测棋盘约为 53.44 × 33.40 cm；
3. 实测固定 Tag 内边到棋盘边缘的 Gap；
4. 固定摄像头，确保四个场地 Tag 和车顶 Tag 同时可见；
5. 分别把小车放在 `A-1`、`H-1`、`A-5`、`H-5` 和中央格；
6. 每个位置连续读取至少 5 次，格子结果必须全部正确且稳定；
7. 移动摄像头后必须重新标定；
8. 测试 `F1`、`F2`、`L`、`R` 和组合序列；
9. 确认 SDK 返回的是停车后的新定位帧；
10. 测试 `stop()`、场外位置和 `LocalizationTimeout`。

小车宽度为 5–6 cm，而格宽只有约 6.68 cm。6 cm 车体居中时每侧理论余量仅约 0.34 cm，因此四角和屏幕边缘的真机测试不能省略。

## 9. 自动测试命令

Python SDK 与控制端：

```bash
cd backend_clients
python3 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/python -m unittest discover -s tests -v
```

定位数学：

```bash
cd localizer
npm install
npm test
```

修改提交中应同时包含代码、测试和 README，不要只修改常量。

## 10. 完成标准

- [ ] SDK 和定位页面统一为 8 列×5行；
- [ ] `fieldWidth === 53.44`，`fieldHeight === 33.40`；
- [ ] 有效范围为 `A-1..H-5`；
- [ ] `H-5` 自动测试通过；
- [ ] 右边界与下边界不会生成非法格子；
- [ ] Python 和 JavaScript 的 rows/columns 完全一致；
- [ ] `/api/info` 或 `/api/location` 能报告网格规格；
- [ ] 调试页面显示“8 列 × 5 行”；
- [ ] 原有动作序列、急停和三帧定位测试继续通过；
- [ ] 27 寸屏幕五点定位验收通过；
- [ ] `F/L/R` 真机组合任务执行并返回正确最终格；
- [ ] 文档中不存在仍用于当前版本的 5列×8行说明。

## 11. 不需要修改的部分

本次调整不要求重写：

- UDP 轮速协议；
- `F<n> / L / R` 动作语法；
- 90° 定时转向逻辑；
- 三帧中值与圆均值融合；
- `MissionResult` 的基本返回结构；
- R0/R1 独立运行器；
- 测试控制前端的整体架构。

核心任务只是让定位服务、Python SDK、调试页面、测试和文档共同使用同一个横屏 8列×5行坐标系。
