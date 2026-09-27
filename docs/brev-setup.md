# NVIDIA Brev setup (proof of use)

Record every command actually run, with the time. This file goes in the submission.

| Item | Value |
| --- | --- |
| GPU | TODO (e.g. L40S 48 GB) |
| Price per hour | TODO |
| Model | nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8 |
| Server | vLLM TODO version, OpenAI-compatible API on port 8000 |
| Connection | `brev port-forward <instance> --port 8000:8000` → http://localhost:8000/v1 |
| Used for | File and module summaries, agent step labels, risk flags, fallback answers |

## Steps

1. `brew install brevdev/homebrew-brev/brev` then `brev login`
2. Create a GPU instance with ≥48 GB GPU memory in the Brev console (name: `brainstorm-gpu`)
3. `brev shell brainstorm-gpu`
4. `tmux new -s model` then `pip install -U vllm` (0.12 or newer)
5. Start the model:
   ```bash
   vllm serve nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8 \
     --served-model-name nemotron --max-model-len 32768 \
     --trust-remote-code --port 8000 --api-key "$NEMOTRON_KEY"
   ```
   Detach with Ctrl+B, then D. The first download is about 30 GB.
6. On the Mac, in a separate terminal: `brev port-forward brainstorm-gpu --port 8000:8000`
7. Test:
   ```bash
   curl http://localhost:8000/v1/chat/completions -H "Authorization: Bearer $NEMOTRON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"nemotron","messages":[{"role":"user","content":"Say hi"}],"chat_template_kwargs":{"enable_thinking":false}}'
   ```

**If out of memory:** use `--max-model-len 16384` or an 80 GB GPU. **If the model won't load:** use a smaller NVIDIA Nemotron Nano from https://huggingface.co/nvidia.

## Command log

| Time | Where | Command | Result |
| --- | --- | --- | --- |
