FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Pinned Geonames CZ postal-code dataset (CC-BY 4.0). Bundled at image
# build time so the running container is fully offline and the dataset
# version is reproducible from the image tag.
ARG GEONAMES_URL=https://download.geonames.org/export/zip/CZ.zip
RUN mkdir -p /data \
 && curl -fsSL "$GEONAMES_URL" -o /tmp/CZ.zip \
 && unzip -p /tmp/CZ.zip CZ.txt > /data/CZ.txt \
 && rm /tmp/CZ.zip \
 && wc -l /data/CZ.txt

COPY services/geo-cz/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/geo-cz/src/ ./src/

ENV GEO_DATA_PATH=/data/CZ.txt
EXPOSE 8000
CMD ["python", "-m", "src.main"]
