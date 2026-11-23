CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id=1), name TEXT NOT NULL, address TEXT NOT NULL, phone TEXT NOT NULL,
  gridStep INTEGER NOT NULL CHECK (gridStep BETWEEN 5 AND 120), bookingDays INTEGER NOT NULL CHECK (bookingDays BETWEEN 1 AND 90)
);
INSERT OR IGNORE INTO settings VALUES (1, 'Барбершоп Бритва', 'Саратов, ул. Волжская, 28', '+78452251707', 30, 14);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, durationMin INTEGER NOT NULL CHECK (durationMin BETWEEN 5 AND 720),
  price INTEGER NOT NULL CHECK (price>=0), color TEXT NOT NULL, active INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS masters (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, workSchedule TEXT NOT NULL,
  rotationFrom TEXT, active INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS master_services (
  masterId TEXT REFERENCES masters(id), serviceId TEXT REFERENCES services(id), PRIMARY KEY (masterId,serviceId)
);
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, masterId TEXT REFERENCES masters(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS blocks_scope ON blocks(date, coalesce(masterId,''));
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, serviceId TEXT NOT NULL REFERENCES services(id), masterId TEXT NOT NULL REFERENCES masters(id),
  clientName TEXT NOT NULL, clientPhone TEXT NOT NULL, date TEXT NOT NULL, startTime TEXT NOT NULL, endTime TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONFIRMED','DONE','CANCELLED','NO_SHOW')),
  comment TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL, tokenHash TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), deletedAt INTEGER,
  CHECK(startTime < endTime)
);
CREATE UNIQUE INDEX IF NOT EXISTS booking_slot ON bookings(masterId,date,startTime) WHERE deletedAt IS NULL AND status<>'CANCELLED';
CREATE INDEX IF NOT EXISTS booking_date ON bookings(date, startTime);
CREATE TRIGGER IF NOT EXISTS booking_overlap_insert BEFORE INSERT ON bookings
WHEN NEW.deletedAt IS NULL AND NEW.status<>'CANCELLED' AND EXISTS (
  SELECT 1 FROM bookings b WHERE b.masterId=NEW.masterId AND b.date=NEW.date
  AND b.deletedAt IS NULL AND b.status<>'CANCELLED' AND b.startTime<NEW.endTime AND b.endTime>NEW.startTime
) BEGIN SELECT RAISE(ABORT,'ZAPIS_OVERLAP'); END;
CREATE TRIGGER IF NOT EXISTS booking_overlap_update BEFORE UPDATE OF masterId,date,startTime,endTime,deletedAt,status ON bookings
WHEN NEW.deletedAt IS NULL AND NEW.status<>'CANCELLED' AND EXISTS (
  SELECT 1 FROM bookings b WHERE b.id<>NEW.id AND b.masterId=NEW.masterId AND b.date=NEW.date
  AND b.deletedAt IS NULL AND b.status<>'CANCELLED' AND b.startTime<NEW.endTime AND b.endTime>NEW.startTime
) BEGIN SELECT RAISE(ABORT,'ZAPIS_OVERLAP'); END;
CREATE TABLE IF NOT EXISTS admins (login TEXT PRIMARY KEY, passwordHash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (tokenHash TEXT PRIMARY KEY, login TEXT NOT NULL REFERENCES admins(login), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
