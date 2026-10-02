# 自定义兵种格式（v1）

在侧栏 **自定义兵种** 中导入 JSON，然后在 **配置双方阵容** 中选择兵种、数量和阵营，最后点击 **开始对战**。导入内容保留到当前页面关闭；需要自动加载时，将同样的 JSON 放在忽略目录 `public/local-assets/creatures.json`。无需准备任何模型即可用几何替身对战。

可直接导入 [完整示例](../examples/custom-creatures.json)。编辑器可关联 [JSON Schema](../schemas/creature-pack.schema.json)。程序入口是 `parseCreaturePack()` 与 `registerCreaturePack()`；内置兵种也使用 `CreatureDefinition`，定义在 `src/creatures.ts`。

```json
{
  "version": 1,
  "creatures": [{
    "id": "custom-guard",
    "label": "自定义卫士",
    "faction": "自定义城堡",
    "ruleset": "custom",
    "stats": {
      "health": 35, "attack": 10, "defense": 12,
      "minDamage": 6, "maxDamage": 9, "speed": 5
    },
    "mechanisms": [{ "type": "additionalAttacks", "count": 1 }]
  }]
}
```

## 字段

| 字段 | 含义与限制 |
| --- | --- |
| `version` | 固定为 `1`；将来不兼容的格式会升级版本 |
| `creatures` | 1–256 个兵种；导入文件最多 1 MB |
| `id` | 小写字母开头，后接小写字母、数字或 `-`，最多 64 字符；必须唯一 |
| `label`, `faction` | 名称和选择器分组，1–80 字符，不能全为空白 |
| `ruleset` | 导入兵种必须是 `custom`；内置原版 ID 禁止覆盖，避免自定义平衡污染原版模式 |
| `stats.health` | 每只生命，1–100,000 |
| `stats.attack`, `stats.defense` | 基础攻防，0–1,000 |
| `stats.minDamage`, `stats.maxDamage` | 每只伤害区间，1–100,000；下限不能超过上限 |
| `stats.speed` | 行动顺序和每回合移动距离，1–50 |
| `mechanisms` | 明确支持的机制数组；没有特性时填 `[]`；同种机制最多出现一次 |

所有数值为整数。未知字段、未知机制、重复 ID、重复机制与非法数值均报出字段路径。注册前验证整个包；任一项失败则整个包不加入目录。重复导入已注册 ID 会报错；修改文件后重新加载页面或采用新 ID。

## 已实现机制

| 配置 | 战斗语义 |
| --- | --- |
| `{ "type": "flying" }` | 按六角格距离限制飞行；允许跨越障碍和队伍，落点必须空且在棋盘内 |
| `{ "type": "additionalAttacks", "count": 1 }` | 正常攻击外追加 1–4 击；每击重新按存活数量算伤害；第一击后可发生反击；任一队阵亡即停止 |
| `{ "type": "regeneration", "health": 10 }` | 每回合开始最多恢复这些 HP，只治疗受伤的末只，不能复活或恢复死队；1–100,000 |
| `{ "type": "retaliations", "count": 2 }` | 每回合最多反击这些次；0–100；省略时为 1；追加攻击不会再次触发反击 |
| `{ "type": "blocksRetaliation" }` | 自己主动攻击时阻止敌人反击；不消耗敌人的反击额度 |

机制由纯模拟层解析，与 Three.js 无关。共同生命周期为：回合开始（重置行动和反击、回血）→ 速度排序/等待排序 → 移动或主动攻击 → 反击 → 追加攻击 → 结束行动/检查胜负。反击不占用正常行动，也不触发连击。防御是战场动作而非兵种机制，增加基础防御的 20%（向下取整，至少 1），到该队下一次激活时结束。

这些是当前实现的机制集合。远程、双格、范围攻击、吸血、施法等仍未实现，不能通过写一个未支持的 `type` 启用。新增机制时同时扩展 `Mechanism` 联合类型、格式校验、Schema 和纯模拟生命周期中的对应处理，并添加行为测试；无需在渲染层按兵种 ID 写分支。

## 配套模型

兵种数据与美术清单按相同 `id` 关联。自动加载 GLB 时，在忽略目录 `public/local-assets/manifest.json` 中添加：

```json
{
  "units": {
    "custom-guard": {
      "label": "自定义卫士",
      "faction": "自定义城堡",
      "url": "/local-assets/custom-guard.glb",
      "height": 2.35
    }
  }
}
```

模型支持 `idle`、`walk`、`attack`、`hit`、`death` 动画。缺少美术使用程序生成替身。初始载入失败保留替身；替换已有队伍时模型失败保留原队伍。页面的本地 GLB 导入只替换选中队伍外观，战斗规则仍来自兵种定义。

带私有路径的配置、GLB、贴图和 Blender 文件只放在忽略目录；公开的示例和 Schema 都只含规则数据。自定义兵种在目录中标记，不能据此宣称原版 H3 平衡。
