/* Compile against expo-sqlite's actual vendored SQLite, not system SQLite.
 * FTS owns the statements exposed by next_stmt; only it may finalize them. */
#include "sqlite3.h"
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void unsafe_close_signal(int signal_number) {
  (void)signal_number;
  _Exit(88); /* Negative control stays in its child, without a crash dialog. */
}
static void sql(sqlite3 *database, const char *source) {
  char *error = NULL;
  if (exsqlite3_exec(database, source, NULL, NULL, &error) != SQLITE_OK) {
    fprintf(stderr, "SQLite fixture failed: %s\n", error ? error : "unknown");
    exit(3);
  }
}
static sqlite3 *open_database(const char *path) {
  sqlite3 *database = NULL;
  if (exsqlite3_open(path, &database) != SQLITE_OK) exit(4);
  return database;
}
static int count(sqlite3 *database) {
  exsqlite3_stmt *statement = NULL;
  if (exsqlite3_prepare_v2(database,
      "SELECT COUNT(*) FROM lyric_search WHERE lyric_search MATCH 'original'",
      -1, &statement, NULL) != SQLITE_OK) exit(5);
  if (exsqlite3_step(statement) != SQLITE_ROW) exit(6);
  int result = exsqlite3_column_int(statement, 0);
  if (exsqlite3_finalize(statement) != SQLITE_OK) exit(7);
  return result;
}
int main(int argc, char **argv) {
  if (argc != 3) return 2;
  int unsafe = !strcmp(argv[1], "expo-finalize");
  if (unsafe) { signal(SIGSEGV, unsafe_close_signal); signal(SIGABRT, unsafe_close_signal); }
  sqlite3 *primary = open_database(argv[2]);
  sql(primary, "PRAGMA journal_mode=WAL; CREATE VIRTUAL TABLE IF NOT EXISTS lyric_search USING fts5(song_id UNINDEXED,tokens)");
  for (int at = 0; at < 200; at++) {
    sqlite3 *transaction = open_database(argv[2]);
    sql(transaction, "BEGIN; INSERT INTO lyric_search(song_id,tokens) VALUES('song','original translation romanization'); COMMIT");
    if (count(transaction) != at + 1) return 8;
    exsqlite3_stmt *statement = exsqlite3_next_stmt(transaction, NULL);
    if (!statement) return 9; /* Must exercise retained FTS-owned statements. */
    if (unsafe) {
      /* Exactly Expo NativeDatabaseBinding::sqlite3_finalize_all_statement. */
      while (statement) {
        exsqlite3_stmt *next = exsqlite3_next_stmt(transaction, statement);
        exsqlite3_finalize(statement);
        statement = next;
      }
    }
    /* The safe option skips the sweep; SQLite closes its own FTS objects. */
    if (exsqlite3_close(transaction) != SQLITE_OK) return 10;
  }
  if (count(primary) != 200 || exsqlite3_close(primary) != SQLITE_OK) return 11;
  primary = open_database(argv[2]);
  if (count(primary) != 200 || exsqlite3_close(primary) != SQLITE_OK) return 12;
  puts("200 FTS transaction closes plus primary close/reopen preserved all 200 rows");
  return 0;
}
