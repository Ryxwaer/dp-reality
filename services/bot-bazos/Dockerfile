FROM alpine:3 AS geo-data
RUN apk add --no-cache curl unzip
ARG GEONAMES_URL=https://download.geonames.org/export/zip/CZ.zip
RUN mkdir -p /data \
 && curl -fsSL "$GEONAMES_URL" -o /tmp/CZ.zip \
 && unzip -p /tmp/CZ.zip CZ.txt > /data/CZ.txt \
 && rm /tmp/CZ.zip \
 && wc -l /data/CZ.txt

FROM python:3.12-slim
WORKDIR /app

COPY services/bot-bazos/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=geo-data /data /data
COPY services/bot-bazos/src/ ./src/

ENV GEO_DATA_PATH=/data/CZ.txt
EXPOSE 8000
CMD ["python", "-m", "src.main"]
