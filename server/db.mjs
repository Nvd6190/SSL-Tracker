/**
 * Azure SQL Database module for SSL Tracker.
 * Uses tedious (TDS protocol) for Azure SQL connectivity.
 */
import { Connection, Request, TYPES } from 'tedious';

const SQL_CONFIG = {
  server: process.env.SQL_SERVER || 'ssltracker-nvd.database.windows.net',
  authentication: {
    type: 'default',
    options: {
      userName: process.env.SQL_USER || 'sqladmin',
      password: process.env.SQL_PASSWORD || 'Admin@12345',
    },
  },
  options: {
    database: process.env.SQL_DATABASE || 'ssl-tracker-db',
    encrypt: true,
    trustServerCertificate: false,
    connectTimeout: 30000,
    requestTimeout: 30000,
  },
};

/** Execute a SQL query and return rows as objects. */
function execQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    const conn = new Connection(SQL_CONFIG);
    conn.on('connect', (err) => {
      if (err) return reject(err);
      const rows = [];
      const req = new Request(sql, (err, rowCount) => {
        conn.close();
        if (err) return reject(err);
        resolve(rows);
      });
      for (const p of params) {
        req.addParameter(p.name, p.type, p.value);
      }
      req.on('row', (columns) => {
        const row = {};
        columns.forEach((col) => { row[col.metadata.colName] = col.value; });
        rows.push(row);
      });
      conn.execSql(req);
    });
    conn.connect();
  });
}

/** Execute a SQL statement (INSERT/UPDATE/DELETE) and return affected count. */
function execNonQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    const conn = new Connection(SQL_CONFIG);
    conn.on('connect', (err) => {
      if (err) return reject(err);
      const req = new Request(sql, (err, rowCount) => {
        conn.close();
        if (err) return reject(err);
        resolve(rowCount);
      });
      for (const p of params) {
        req.addParameter(p.name, p.type, p.value);
      }
      conn.execSql(req);
    });
    conn.connect();
  });
}

/** Create the certificates table if it doesn't exist. */
export async function initDB() {
  const sql = `
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'certificates')
    CREATE TABLE certificates (
      id            NVARCHAR(100)  PRIMARY KEY,
      commonName    NVARCHAR(500)  NOT NULL,
      issuedTo      NVARCHAR(500)  NOT NULL DEFAULT '',
      issuer        NVARCHAR(500)  NOT NULL DEFAULT '',
      owner         NVARCHAR(500)  NOT NULL DEFAULT '',
      contact       NVARCHAR(500)  NOT NULL DEFAULT '',
      customerPocName  NVARCHAR(500)  NOT NULL DEFAULT '',
      customerPocEmail NVARCHAR(500)  NOT NULL DEFAULT '',
      customerPocPhone NVARCHAR(200)  NOT NULL DEFAULT '',
      expiresOn     NVARCHAR(50)   NOT NULL,
      validFrom     NVARCHAR(50)   NULL,
      renewedOn     NVARCHAR(50)   NULL,
      autoRenew     BIT            NOT NULL DEFAULT 0,
      certType      NVARCHAR(50)   NOT NULL DEFAULT 'Single Domain',
      sanList       NVARCHAR(MAX)  NOT NULL DEFAULT '[]',
      tags          NVARCHAR(MAX)  NOT NULL DEFAULT '[]',
      notes         NVARCHAR(MAX)  NOT NULL DEFAULT '',
      createdAt     DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
      updatedAt     DATETIME2      NOT NULL DEFAULT GETUTCDATE()
    );
  `;
  await execNonQuery(sql);

  const subSql = `
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'subdomains')
    CREATE TABLE subdomains (
      name          NVARCHAR(500)  NOT NULL,
      parentDomain  NVARCHAR(500)  NOT NULL,
      sources       NVARCHAR(MAX)  NOT NULL DEFAULT '[]',
      discoveredAt  DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
      PRIMARY KEY (name, parentDomain)
    );
  `;
  await execNonQuery(subSql);

  console.log('✅ Database initialized');
}

/** Get all certificate records. */
export async function getAllCerts() {
  const rows = await execQuery('SELECT * FROM certificates ORDER BY expiresOn ASC');
  return rows.map(rowToRecord);
}

/** Insert or update a certificate record (upsert). */
export async function upsertCert(record) {
  const sql = `
    MERGE certificates AS target
    USING (SELECT @id AS id) AS source
    ON target.id = source.id
    WHEN MATCHED THEN
      UPDATE SET
        commonName = @commonName, issuedTo = @issuedTo, issuer = @issuer,
        owner = @owner, contact = @contact,
        customerPocName = @customerPocName, customerPocEmail = @customerPocEmail,
        customerPocPhone = @customerPocPhone,
        expiresOn = @expiresOn, validFrom = @validFrom, renewedOn = @renewedOn,
        autoRenew = @autoRenew, certType = @certType,
        sanList = @sanList, tags = @tags, notes = @notes,
        updatedAt = GETUTCDATE()
    WHEN NOT MATCHED THEN
      INSERT (id, commonName, issuedTo, issuer, owner, contact,
              customerPocName, customerPocEmail, customerPocPhone,
              expiresOn, validFrom, renewedOn, autoRenew, certType,
              sanList, tags, notes)
      VALUES (@id, @commonName, @issuedTo, @issuer, @owner, @contact,
              @customerPocName, @customerPocEmail, @customerPocPhone,
              @expiresOn, @validFrom, @renewedOn, @autoRenew, @certType,
              @sanList, @tags, @notes);
  `;
  const params = [
    { name: 'id',               type: TYPES.NVarChar, value: record.id },
    { name: 'commonName',       type: TYPES.NVarChar, value: record.commonName },
    { name: 'issuedTo',         type: TYPES.NVarChar, value: record.issuedTo || '' },
    { name: 'issuer',           type: TYPES.NVarChar, value: record.issuer || '' },
    { name: 'owner',            type: TYPES.NVarChar, value: record.owner || '' },
    { name: 'contact',          type: TYPES.NVarChar, value: record.contact || '' },
    { name: 'customerPocName',  type: TYPES.NVarChar, value: record.customerPocName || '' },
    { name: 'customerPocEmail', type: TYPES.NVarChar, value: record.customerPocEmail || '' },
    { name: 'customerPocPhone', type: TYPES.NVarChar, value: record.customerPocPhone || '' },
    { name: 'expiresOn',        type: TYPES.NVarChar, value: record.expiresOn },
    { name: 'validFrom',        type: TYPES.NVarChar, value: record.validFrom || null },
    { name: 'renewedOn',        type: TYPES.NVarChar, value: record.renewedOn || null },
    { name: 'autoRenew',        type: TYPES.Bit,      value: record.autoRenew ? 1 : 0 },
    { name: 'certType',         type: TYPES.NVarChar, value: record.certType || 'Single Domain' },
    { name: 'sanList',          type: TYPES.NVarChar, value: JSON.stringify(record.sanList || []) },
    { name: 'tags',             type: TYPES.NVarChar, value: JSON.stringify(record.tags || []) },
    { name: 'notes',            type: TYPES.NVarChar, value: record.notes || '' },
  ];
  await execNonQuery(sql, params);
}

/** Bulk upsert multiple records. */
export async function bulkUpsert(records) {
  for (const rec of records) {
    await upsertCert(rec);
  }
}

/** Delete a certificate by id. */
export async function deleteCert(id) {
  await execNonQuery('DELETE FROM certificates WHERE id = @id', [
    { name: 'id', type: TYPES.NVarChar, value: id },
  ]);
}

/** Convert a SQL row to a CertificateRecord shape. */
function rowToRecord(row) {
  return {
    id: row.id,
    commonName: row.commonName,
    issuedTo: row.issuedTo || '',
    issuer: row.issuer || '',
    owner: row.owner || '',
    contact: row.contact || '',
    customerPocName: row.customerPocName || '',
    customerPocEmail: row.customerPocEmail || '',
    customerPocPhone: row.customerPocPhone || '',
    expiresOn: row.expiresOn,
    validFrom: row.validFrom || null,
    renewedOn: row.renewedOn || null,
    autoRenew: !!row.autoRenew,
    certType: row.certType || 'Single Domain',
    sanList: safeParse(row.sanList, []),
    tags: safeParse(row.tags, []),
    notes: row.notes || '',
  };
}

function safeParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

/** Get all discovered subdomains. */
export async function getAllSubdomains() {
  const rows = await execQuery('SELECT * FROM subdomains ORDER BY parentDomain, name');
  return rows.map((row) => ({
    name: row.name,
    parentDomain: row.parentDomain,
    sources: safeParse(row.sources, []),
  }));
}

/** Upsert a single subdomain entry (merge sources). */
export async function upsertSubdomain(entry) {
  const sql = `
    MERGE subdomains AS target
    USING (SELECT @name AS name, @parentDomain AS parentDomain) AS source
    ON target.name = source.name AND target.parentDomain = source.parentDomain
    WHEN MATCHED THEN
      UPDATE SET sources = @sources, discoveredAt = GETUTCDATE()
    WHEN NOT MATCHED THEN
      INSERT (name, parentDomain, sources)
      VALUES (@name, @parentDomain, @sources);
  `;
  await execNonQuery(sql, [
    { name: 'name',         type: TYPES.NVarChar, value: entry.name },
    { name: 'parentDomain', type: TYPES.NVarChar, value: entry.parentDomain },
    { name: 'sources',      type: TYPES.NVarChar, value: JSON.stringify(entry.sources || []) },
  ]);
}

/** Bulk upsert multiple subdomain entries. */
export async function bulkUpsertSubdomains(entries) {
  for (const entry of entries) {
    await upsertSubdomain(entry);
  }
}

/** Delete all subdomains for a given parent domain. */
export async function deleteSubdomainsByDomain(parentDomain) {
  await execNonQuery('DELETE FROM subdomains WHERE parentDomain = @parentDomain', [
    { name: 'parentDomain', type: TYPES.NVarChar, value: parentDomain },
  ]);
}
