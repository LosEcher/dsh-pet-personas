#!/usr/bin/env python3
"""m3-pet-frame.py — 在 M3 的 ComfyUI 上跑**一张**宠物候选帧（编辑管线，不是文生图）。

为什么是"编辑"而不是"文生图"（2026-11-01 定案）：文生图每次都会画出"另一个角色"；宠物素材的命门
是**跨帧一致性**，唯一可靠的做法是以现有帧为底图、只改局部（眼睛/姿态），所以这里用
`TextEncodeQwenImage21` 的参考图条件 + 低 denoise。

节点图（与 M3 上 `scripts/swap_heads.py` 的实测可用图同构，但**去掉 MediaPipe 人脸节点**：
我们的素材是 96px 像素画，人脸检测器在那上面不可靠，且本次不需要精确换头）：

    LoadImage(参考) → ImageScaleToTotalPixels → (reference 条件)
    UnetLoaderGGUF + CLIPLoaderGGUF + VAELoader + QwenImage21Cache
    TextEncodeQwenImage21(images.image_1=参考, prompt)
    VAEEncode(参考) → KSampler(denoise) → VAEDecode → SaveImageAdvanced

用法（在 M3 上）：
    python3 m3-pet-frame.py --ref pet_idle_col0.png --prompt "..." --prefix pet/idle_closed \
        [--denoise 0.55] [--megapixels 0.2] [--steps 10] [--seed 1] [--port 8188] [--timeout 900]

输出：最后一行打印 `RESULT <绝对路径>`，退出码 0=成功 / 1=任务失败 / 2=连不上或超时（判不了）。
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

MODELS = {
    "unet": "qwen_image_2.1-Q6_K.gguf",
    "clip": "qwen3vl_8b_heretic-Q4_K_M.gguf",
    "vae": "qwen_image_2.1_vae_bf16.safetensors",
}

DEFAULT_NEGATIVE = (
    "blurry, jpeg artifacts, gradient shading, anti-aliasing, 3d render, photorealistic, "
    "text, watermark, extra limbs, different character, different hair color"
)


def api(port, path, payload=None, timeout=30):
    url = f"http://127.0.0.1:{port}{path}"
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
    return json.loads(body) if body else {}


def build_prompt(ref_name, prompt, prefix, denoise, megapixels, steps, seed):
    return {
        # 参考图（ComfyUI 的 input 目录里的文件名）
        "1": {"class_type": "LoadImage", "inputs": {"image": ref_name}},
        # 96px 太小，模型看不清；放大到 ~0.2MP 再画，回来再缩 + 量化（收口门禁负责）
        "2": {"class_type": "ImageScaleToTotalPixels", "inputs": {
            "image": ["1", 0], "upscale_method": "lanczos",
            "megapixels": megapixels, "resolution_steps": 32,
        }},
        "8": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": MODELS["unet"]}},
        "9": {"class_type": "CLIPLoaderGGUF", "inputs": {"clip_name": MODELS["clip"], "type": "qwen_image"}},
        "10": {"class_type": "VAELoader", "inputs": {"vae_name": MODELS["vae"]}},
        "11": {"class_type": "QwenImage21Cache", "inputs": {
            "model": ["8", 0], "device": "cpu", "dtype": "int8",
        }},
        "12": {"class_type": "TextEncodeQwenImage21", "inputs": {
            "clip": ["9", 0], "prompt": prompt, "negative_prompt": DEFAULT_NEGATIVE,
            "vae": ["10", 0], "resolution": 0, "images.image_1": ["2", 0],
        }},
        "13": {"class_type": "VAEEncode", "inputs": {"pixels": ["2", 0], "vae": ["10", 0]}},
        "15": {"class_type": "KSampler", "inputs": {
            "model": ["11", 0], "positive": ["12", 0], "negative": ["12", 1],
            "latent_image": ["13", 0], "seed": seed, "steps": steps, "cfg": 1,
            "sampler_name": "euler", "scheduler": "simple", "denoise": denoise,
        }},
        "16": {"class_type": "VAEDecode", "inputs": {"samples": ["15", 0], "vae": ["10", 0]}},
        "17": {"class_type": "SaveImageAdvanced", "inputs": {
            "images": ["16", 0], "filename_prefix": prefix, "format": "png",
            "format.bit_depth": "8-bit", "format.input_color_space": "sRGB",
        }},
    }


def main(argv):
    ap = argparse.ArgumentParser(description="在 M3 ComfyUI 上生成一张宠物候选帧（编辑管线）")
    ap.add_argument("--ref", required=True, help="ComfyUI input 目录里的参考图文件名")
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--prefix", default="pet/candidate")
    ap.add_argument("--denoise", type=float, default=0.55)
    ap.add_argument("--megapixels", type=float, default=0.2)
    ap.add_argument("--steps", type=int, default=10)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--port", type=int, default=8188)
    ap.add_argument("--timeout", type=float, default=900)
    ap.add_argument("--outdir", default=os.path.expanduser("~/projects/qwen21/ComfyUI/output"))
    args = ap.parse_args(argv)

    try:
        api(args.port, "/system_stats", timeout=5)
    except (urllib.error.URLError, OSError) as exc:
        print(f"判不了：ComfyUI 连不上（{exc}）", file=sys.stderr)
        return 2

    prompt = build_prompt(args.ref, args.prompt, args.prefix, args.denoise,
                          args.megapixels, args.steps, args.seed)
    try:
        queued = api(args.port, "/prompt", {"prompt": prompt, "client_id": "pet-frames"})
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:800]
        print(f"任务被拒绝（HTTP {exc.code}）：{detail}", file=sys.stderr)
        return 1
    prompt_id = queued.get("prompt_id")
    if not prompt_id:
        print(f"没拿到 prompt_id：{queued}", file=sys.stderr)
        return 1
    print(f"已排队 prompt_id={prompt_id}", flush=True)

    started = time.time()
    while time.time() - started < args.timeout:
        time.sleep(3)
        hist = api(args.port, f"/history/{prompt_id}")
        entry = hist.get(prompt_id)
        if not entry:
            continue
        status = entry.get("status") or {}
        if status.get("status_str") == "error":
            print(f"任务失败：{json.dumps(status.get('messages', []))[:800]}", file=sys.stderr)
            return 1
        images = []
        for node_out in (entry.get("outputs") or {}).values():
            images.extend(node_out.get("images") or [])
        if not images:
            continue
        image = images[0]
        path = os.path.join(args.outdir, image.get("subfolder", ""), image["filename"])
        if not os.path.exists(path):
            print(f"输出文件不存在：{path}", file=sys.stderr)
            return 1
        print(f"RESULT {os.path.abspath(path)}")
        print(f"耗时 {time.time() - started:.1f}s", file=sys.stderr)
        return 0
    print(f"超时（{args.timeout}s）—— 判不了，不要当作失败重试", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
