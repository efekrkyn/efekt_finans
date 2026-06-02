FROM python:3.12-slim

# Install git so pip can download chronos-forecasting from Github
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces require running as a non-root user (uid 1000)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR $HOME/app

COPY --chown=user ./requirements.txt $HOME/app/requirements.txt
RUN pip install --no-cache-dir --upgrade -r requirements.txt

COPY --chown=user . $HOME/app

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
