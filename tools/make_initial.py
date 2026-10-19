#!/usr/bin/env python3
"""筋トレMEMOから書き出したCSVを、このアプリの取り込み用JSONに変換する。

usage: make_initial.py <筋トレMEMO_記録.csv> <出力.json>
出力は個人データなので private/ に置き、公開リポジトリには含めない。
"""
import csv
import json
import re
import sys

PARTS = {
    "胸": ["ダンベルプレス", "ダンベルプレス（フラット）", "ダンベルプレス（ディクライン）", "ベンチプレス",
          "ダンベルフライ", "ケーブルクロスオーバー", "ケーブルクロス", "バタフライ", "腕立て伏せ"],
    "背中": ["チンニング（懸垂）", "ワンハンドローイング", "プーリーロー", "ラットプルダウン", "インクラインダンベルロウ",
           "ベントオーバーロー", "デッドリフト", "ビュアロウ", "ダンベルローイング", "斜め懸垂"],
    "肩": ["ショルダープレス", "サイドレイズ", "アーノルドプレス", "スミスバックプレス", "アップライトロウ",
          "フロントレイズ", "肩7分トレ"],
    "腕": ["アームカール", "アームカール（ワンハンド）", "バーベルカール", "ハンマーカール", "スカルクラッシャー",
          "ケーブルプレスダウン", "フレンチプレス", "リストカール", "握力グリップ"],
    "脚": ["スクワット", "カーフレイズ"],
    "腹筋": ["アブローラー", "クランチ", "レッグレイズ", "上体起こし"],
    "有酸素": ["ランニング", "自転車"],
}
PART_OF = {ex: p for p, names in PARTS.items() for ex in names}


def num(s):
    return float(s) if s not in ("", None) else None


def main(src, dst):
    sessions = {}
    exercises = {}
    for r in csv.DictReader(open(src, encoding="utf-8-sig")):
        d, ex, memo = r["日付"], r["種目"], r["メモ"]
        day = sessions.setdefault(d, {"items": []})
        kind = "cardio" if memo.startswith("有酸素:") else "strength"
        item = next((i for i in day["items"] if i["exercise"] == ex), None)
        if item is None:
            item = {"exercise": ex, "kind": kind, "sets": []}
            day["items"].append(item)
        if kind == "cardio":
            km = re.search(r"([\d.]+)km", memo)
            mins = re.search(r"([\d.]+)分", memo)
            kcal = re.search(r"([\d.]+)kcal", memo)
            item["sets"].append({"km": float(km.group(1)) if km else None,
                                 "min": float(mins.group(1)) if mins else None,
                                 "kcal": float(kcal.group(1)) if kcal else None, "memo": ""})
        else:
            w, n = num(r["重量kg"]), num(r["回数"])
            item["sets"].append({"w": w, "r": int(n) if n is not None else None,
                                 "memo": "" if memo == "回数の記録なし" else memo})
        exercises.setdefault(ex, {"part": PART_OF.get(ex, "その他"), "kind": kind})
    data = {"app": "kintore-log", "version": 1, "source": "筋トレMEMOから移行",
            "sessions": dict(sorted(sessions.items())), "exercises": exercises}
    json.dump(data, open(dst, "w"), ensure_ascii=False, indent=1)
    n_sets = sum(len(i["sets"]) for s in sessions.values() for i in s["items"])
    print(f"{dst}: {len(sessions)} 日 / {n_sets} セット / 種目 {len(exercises)}")
    unknown = [e for e, v in exercises.items() if v["part"] == "その他"]
    if unknown:
        print("部位が「その他」の種目:", unknown)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
