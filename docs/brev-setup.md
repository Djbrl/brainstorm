# NVIDIA Brev setup (proof of use)

Every command actually run, with the time. This file goes in the submission.

The hackathon voucher was not received (late arrival), so the team used its own Brev account with $10 of credit.

| Item | Value |
| --- | --- |
| Instance | `brainstorm-gpu` (Brev ID 60s3zhpl), created 13:58 |
| GPU | 1× NVIDIA L40S, 46 GB, via MassedCompute; 12 vCPU, 72 GB RAM, 625 GB disk |
| Price | $1.06/hour, storage included (this instance type can't be paused, only deleted) |
| Model | [nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8) |
| Server | vLLM 0.30.0 (official `vllm/vllm-openai` Docker image), OpenAI-compatible API, protected by an API key |
| Exposure | Bound to 127.0.0.1 on the GPU machine only; reached from the Mac through an encrypted `brev port-forward` tunnel. Not public. |
| App endpoint | http://localhost:8000/v1, model name `nemotron` |
| Used for | File and module summaries, agent step labels, risk flags, fallback answers |

## Command log

| Time | Where | Command | Result |
| --- | --- | --- | --- |
| 13:55 | Mac | `brew install brevdev/homebrew-brev/brev` | Brev CLI v0.6.335 |
| 13:58 | Brev console | Create environment: L40S, MassedCompute, $1.06/hr, name `brainstorm-gpu` | Deployed, VM mode |
| 14:05 | Mac | `brev login` (NVIDIA account approval in browser) | Logged in |
| 14:06 | Mac | `brev ls`, `brev refresh` | Instance RUNNING, SSH ready |
| 14:07 | GPU | `nvidia-smi`, `docker info` | L40S 46 GB, Docker with NVIDIA runtime |
| 14:10 | GPU | `docker run -d --name vllm --gpus all --ipc=host --restart unless-stopped -p 127.0.0.1:8000:8000 -v ~/.cache/huggingface:/root/.cache/huggingface vllm/vllm-openai:latest --model nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8 --served-model-name nemotron --max-model-len 32768 --trust-remote-code --gpu-memory-utilization 0.92 --max-num-seqs 16 --api-key $NEMOTRON_KEY` | vLLM 0.30.0 started; downloading model on the GPU machine |
| 14:16 | Mac | `brev port-forward brainstorm-gpu --port 8000:8000` | localhost:8000 → GPU:8000 |

## How to check it's alive

```bash
curl -s http://localhost:8000/v1/models -H "Authorization: Bearer $NEMOTRON_KEY"
ssh brainstorm-gpu 'docker logs --tail 20 vllm'
```

If the tunnel drops, rerun `brev port-forward brainstorm-gpu --port 8000:8000`.

## Calling it from the app

Send `"chat_template_kwargs": {"enable_thinking": false}` with every request, to turn off Nemotron's step-by-step reasoning for fast summaries and labels.

## After submission

Delete the instance in the Brev console (stops billing).
