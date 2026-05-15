FROM python:3.12-slim

WORKDIR /app

COPY services/bot-bezrealitky/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/bot-bezrealitky/src/ ./src/

EXPOSE 8000
CMD ["python", "-m", "src.main"]
