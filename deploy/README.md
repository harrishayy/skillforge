# SAM 3 Brev Deployment

Deploy the SAM 3 inference server on an NVIDIA Brev GPU instance.

## Prerequisites

- NVIDIA Brev account ([brev.nvidia.com](https://brev.nvidia.com))
- Hugging Face account with access to [facebook/sam3](https://huggingface.co/facebook/sam3)

## 1. Create a Brev Instance

1. Log in at [brev.nvidia.com](https://brev.nvidia.com)
2. **Create New Instance** with an A100 40GB, A10G, or L4 GPU
3. Name it `sam3-server` and deploy

## 2. Connect

```bash
brew install brevdev/homebrew-brev/brev   # macOS
brev login
brev shell sam3-server
```

## 3. Install SAM 3

```bash
conda create -n sam3 python=3.12 -y
conda activate sam3
pip install torch==2.7.0 torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
git clone https://github.com/facebookresearch/sam3.git && cd sam3 && pip install -e .
pip install fastapi uvicorn python-multipart huggingface_hub
huggingface-cli login
```

## 4. Run the Server

Copy `sam3_server.py` to the instance then:

```bash
uvicorn sam3_server:app --host 0.0.0.0 --port 8080
```

## 5. Expose the Port

In the Brev Console under **Instance Details > Access**, expose port **8080**.
You'll get a URL like `https://sam3-server-8080-xxxx.brev.dev`.

Test: `curl https://sam3-server-8080-xxxx.brev.dev/health`

## 6. Connect to SkillForge

Set `SAM3_URL` in `skillforge-api/.env`:

```
SAM3_URL=https://sam3-server-8080-xxxx.brev.dev
```

## Keeping It Running

```bash
tmux new -s sam3
conda activate sam3
uvicorn sam3_server:app --host 0.0.0.0 --port 8080
# Ctrl+B, D to detach
```

Stop billing: `brev stop sam3-server` / Resume: `brev start sam3-server`
