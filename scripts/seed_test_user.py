"""Seed a test user with diverse bot configurations across all three bot services.

Run once to provision /reality/.../test fixtures for end-to-end matching
verification. All bots are inserted with email_notifications=false so the
notifier never fires; the goal is to populate the inbox via the
matching pipeline only.

  $ python3 scripts/seed_test_user.py

Re-running deletes any prior test-user state and rewrites it cleanly.
"""
from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from bson import ObjectId
from pymongo import MongoClient
from termcolor import cprint

MONGO_URI = os.environ.get(
    "MONGO_URI",
    "mongodb://dpadmin:140111ad0c48f07af9fdc781e4fb995e6b1cc0f7baaf5fdb@100.68.207.89:27017/dp-reality?authSource=admin&directConnection=true",
)
TEST_EMAIL = "bot-tester@dp-reality.test"
TEST_NAME = "Bot Tester"
TEST_PASSWORD = "TestUser2026!"
TTL_DAYS = 30


def mint_config_id() -> str:
    return secrets.token_hex(12)


def make_unsubscribe_token() -> str:
    return secrets.token_hex(24)


def now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Bot configurations: each tuple is (display name, config-document payload).
# The bot service interprets `config` as the user-supplied filter sub-doc.
# ---------------------------------------------------------------------------

BAZOS_CONFIGS = [
    (
        "Bazos broad sale",
        {"category_main": "prodam", "keywords": []},
    ),
    (
        "Bazos byty prodej < 4M",
        {
            "category_main": "prodam",
            "category_sub": "byt",
            "price_max": 4_000_000,
            "keywords": [],
        },
    ),
    (
        "Bazos pronájem do 30k",
        {
            "category_main": "pronajmu",
            "price_max": 30_000,
            "keywords": [],
        },
    ),
    (
        "Bazos Brno 30km",
        {
            "category_main": "prodam",
            "psc": "60200",
            "radius_km": 30,
            "keywords": [],
        },
    ),
    (
        "Bazos keyword zahrada",
        {"category_main": "prodam", "keywords": ["zahrada"]},
    ),
]

# Sreality codes: category_main_cb 1=byt 2=dum 3=pozemek;
# category_type_cb 1=prodej 2=pronajem 3=drazba.
# Region municipality:5740 = Brno (centre 16.607841, 49.200221).
SREALITY_CONFIGS = [
    (
        "Sreality broad byty",
        {
            "category_main_cb": 1,
            "category_sub_cb": [],
            "ownership_in": [],
            "building_type_in": [],
            "condition_in": [],
            "furnished_in": [],
            "amenities_all": [],
            "media_required": [],
            "exclude_rk_exclusive": False,
        },
    ),
    (
        "Sreality byty prodej < 5M",
        {
            "category_main_cb": 1,
            "category_type_cb": 1,
            "category_sub_cb": [],
            "price_max": 5_000_000,
            "ownership_in": [],
            "building_type_in": [],
            "condition_in": [],
            "furnished_in": [],
            "amenities_all": [],
            "media_required": [],
            "exclude_rk_exclusive": False,
        },
    ),
    (
        "Sreality pronájem do 30k",
        {
            "category_main_cb": 1,
            "category_type_cb": 2,
            "category_sub_cb": [],
            "price_max": 30_000,
            "ownership_in": [],
            "building_type_in": [],
            "condition_in": [],
            "furnished_in": [],
            "amenities_all": [],
            "media_required": [],
            "exclude_rk_exclusive": False,
        },
    ),
    (
        "Sreality Brno 25km byty",
        {
            "category_main_cb": 1,
            "category_sub_cb": [],
            "region_id": "municipality:5740",
            "region_label": "Brno · within 25 km",
            "center": {
                "type": "Point",
                "coordinates": [16.607841, 49.200221],
            },
            "radius_km": 25,
            "ownership_in": [],
            "building_type_in": [],
            "condition_in": [],
            "furnished_in": [],
            "amenities_all": [],
            "media_required": [],
            "exclude_rk_exclusive": False,
        },
    ),
    (
        "Sreality byty osobní vlastnictví",
        {
            "category_main_cb": 1,
            "category_sub_cb": [],
            "ownership_in": ["personal"],
            "building_type_in": [],
            "condition_in": [],
            "furnished_in": [],
            "amenities_all": [],
            "media_required": [],
            "exclude_rk_exclusive": True,
        },
    ),
]

# Bezrealitky: osm_id 438171 = Brno (city). disposition codes match enum.
BEZREALITKY_CONFIGS = [
    (
        "Bezrealitky broad prodej",
        {
            "offer_type": "PRODEJ",
            "disposition_in": [],
            "ownership_in": [],
            "condition_in": [],
            "region_osm_ids": [],
        },
    ),
    (
        "Bezrealitky byty prodej < 6M",
        {
            "offer_type": "PRODEJ",
            "estate_type": "BYT",
            "price_max": 6_000_000,
            "disposition_in": [],
            "ownership_in": [],
            "condition_in": [],
            "region_osm_ids": [],
        },
    ),
    (
        "Bezrealitky pronájem do 25k",
        {
            "offer_type": "PRONAJEM",
            "price_max": 25_000,
            "disposition_in": [],
            "ownership_in": [],
            "condition_in": [],
            "region_osm_ids": [],
        },
    ),
    (
        "Bezrealitky 2+kk a 3+kk",
        {
            "offer_type": "PRODEJ",
            "disposition_in": ["DISP_2_KK", "DISP_3_KK"],
            "ownership_in": [],
            "condition_in": [],
            "region_osm_ids": [],
        },
    ),
    (
        "Bezrealitky Brno 25km",
        {
            "offer_type": "PRODEJ",
            "estate_type": "BYT",
            "disposition_in": [],
            "ownership_in": [],
            "condition_in": [],
            "region_osm_ids": [438171],
            "radius_km": 25,
        },
    ),
]

BOT_PLAN = [
    ("bot-bazos", "bazos_config", BAZOS_CONFIGS),
    ("bot-sreality", "sreality_config", SREALITY_CONFIGS),
    ("bot-bezrealitky", "bezrealitky_config", BEZREALITKY_CONFIGS),
]


def main() -> None:
    cprint(f"Connecting to MongoDB...", "cyan")
    client = MongoClient(MONGO_URI)
    db = client.get_database("dp-reality")

    # 1) Wipe any prior test-user state.
    prior = db.users.find_one({"email": TEST_EMAIL})
    if prior:
        cprint(f"Found existing test user {prior['_id']} — cleaning up.", "yellow")
        prior_hex = str(prior["_id"])
        for bot in (prior.get("bots") or []):
            collection = next(
                (cc for bid, cc, _ in BOT_PLAN if bid == bot["bot_id"]),
                None,
            )
            if collection:
                db[collection].delete_one({"_id": bot["config_id"]})
        db.users.delete_one({"_id": prior["_id"]})
        db.notifications.delete_many({"user_id": prior_hex})
        cprint("  prior user, configs, and notifications deleted.", "yellow")

    # 2) Create the user.
    user_id = ObjectId()
    user_id_hex = str(user_id)
    password_hash = bcrypt.hashpw(
        TEST_PASSWORD.encode("utf-8"), bcrypt.gensalt(rounds=12)
    ).decode("utf-8")
    created_at = now()
    expires_at = created_at + timedelta(days=TTL_DAYS)

    bots_meta = []
    user_doc = {
        "_id": user_id,
        "email": TEST_EMAIL,
        "name": TEST_NAME,
        "password_hash": password_hash,
        "created_at": created_at,
        "bots": bots_meta,
        "unsubscribe_token": make_unsubscribe_token(),
        "preferences": {
            "email_enabled": False,
            "weekly_digest": False,
            "important_updates": False,
        },
    }
    db.users.insert_one(user_doc)
    cprint(f"Created user {user_id_hex} ({TEST_EMAIL}).", "green")

    # 3) For each bot, insert configs into <bot>_config and append metadata.
    grand_total = 0
    for bot_id, config_collection, plan in BOT_PLAN:
        cprint(f"\n→ {bot_id} ({len(plan)} configs)", "cyan")
        for display_name, config_payload in plan:
            config_id = mint_config_id()
            doc = {
                "_id": config_id,
                "user_id": user_id_hex,
                "active": True,
                "created_at": created_at,
                "updated_at": created_at,
                "welcome_sent_at": created_at,
                "config": config_payload,
            }
            db[config_collection].insert_one(doc)
            bots_meta.append(
                {
                    "config_id": config_id,
                    "bot_id": bot_id,
                    "name": display_name,
                    "status": "active",
                    "email_notifications": False,
                    "created_at": created_at,
                    "expires_at": expires_at,
                }
            )
            cprint(f"   • {display_name}  ({config_id})", "white")
            grand_total += 1

    # 4) Persist the populated bots[] array on the user.
    db.users.update_one({"_id": user_id}, {"$set": {"bots": bots_meta}})

    cprint(
        f"\nDone. {grand_total} configurations active for {TEST_EMAIL}.",
        "green",
        attrs=["bold"],
    )
    cprint(
        f"User _id (hex): {user_id_hex}\nLogin: {TEST_EMAIL} / {TEST_PASSWORD}",
        "magenta",
    )


if __name__ == "__main__":
    main()
