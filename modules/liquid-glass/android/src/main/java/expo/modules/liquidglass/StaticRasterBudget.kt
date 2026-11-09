package expo.modules.liquidglass

/** Pixel ownership/budget model; never stores a View, Context, or draw callback. */
internal class StaticRasterBudget<K : Any, V : Any>(private val maximumBytes: Long = 16L * 1024 * 1024) {
    data class Lease<K>(val key: K, val entry: Long, val owner: Long)
    data class Producer<K>(val lease: Lease<K>, val serial: Long)
    data class Stats(val bytes: Long, val entries: Int, val users: Int, val producing: Boolean)
    private class Entry<V>(val serial: Long, val reservation: Long) {
        val owners = mutableSetOf<Long>()
        var value: V? = null
        var bytes = reservation
        var failed = false
    }
    private val entries = LinkedHashMap<K, Entry<V>>(4, .75f, true)
    private var serial = 0L
    private var bytes = 0L
    private var producer: Producer<K>? = null
    var revision = 0L
        private set

    fun acquire(key: K, reservation: Long): Lease<K>? {
        if (reservation <= 0L || reservation > maximumBytes) return null
        val e = entries[key] ?: run {
            if (!makeRoom(reservation)) return null
            Entry<V>(++serial, reservation).also { entries[key] = it; bytes += reservation }
        }
        val id = ++serial
        e.owners += id
        return Lease(key, e.serial, id)
    }

    private fun entry(lease: Lease<K>): Entry<V>? = entries[lease.key]?.takeIf {
        it.serial == lease.entry && lease.owner in it.owners
    }

    fun value(lease: Lease<K>?): V? = lease?.let { entry(it)?.value }

    /** One in-flight capture globally, including concurrent hosts sharing a key. */
    fun claim(lease: Lease<K>?): Producer<K>? {
        if (lease == null) return null
        // An unrelated cache publication can recompose the current leader.
        // Keep its ticket stable, so its capture is not cancelled while the
        // same lease still owns the global producer slot.
        producer?.let { return if (it.lease == lease) it else null }
        val e = entry(lease) ?: return null
        if (e.failed || e.value != null) return null
        return Producer(lease, ++serial).also { producer = it }
    }

    fun complete(ticket: Producer<K>, value: V, actualBytes: Long): Boolean {
        if (producer != ticket) return false
        val e = entry(ticket.lease) ?: return false
        val extra = actualBytes - e.bytes
        if (actualBytes <= 0L || actualBytes > maximumBytes || (extra > 0 && !makeRoom(extra))) {
            fail(ticket)
            return false
        }
        bytes += extra
        e.bytes = actualBytes
        e.value = value
        producer = null
        revision++
        return true
    }

    fun fail(ticket: Producer<K>) {
        if (producer != ticket) return
        entry(ticket.lease)?.let {
            bytes -= it.bytes
            it.bytes = 0L
            it.failed = true
        }
        producer = null
        revision++
    }

    fun release(lease: Lease<K>?) {
        if (lease == null) return
        val e = entry(lease) ?: return
        e.owners -= lease.owner
        if (producer?.lease == lease) {
            producer = null
            revision++ // A surviving host may become the replacement producer.
        }
        if (e.owners.isEmpty()) {
            if (e.value == null || e.failed) {
                entries.remove(lease.key)
                bytes -= e.bytes
            }
            // A resize/theme request may have been denied while this entry
            // was active. It can now be evicted to admit that waiting key.
            revision++
        }
    }

    /** Dropping cache references is safe; never recycle a bitmap held by a consumer/display list. */
    fun trimUnused() {
        val iterator = entries.entries.iterator()
        while (iterator.hasNext()) {
            val e = iterator.next().value
            if (e.owners.isEmpty()) { bytes -= e.bytes; iterator.remove() }
        }
        revision++
    }

    private fun makeRoom(additional: Long): Boolean {
        val iterator = entries.entries.iterator()
        while (bytes + additional > maximumBytes && iterator.hasNext()) {
            val e = iterator.next().value
            if (e.owners.isEmpty()) { bytes -= e.bytes; iterator.remove() }
        }
        return bytes + additional <= maximumBytes
    }

    fun stats(): Stats = Stats(bytes, entries.size, entries.values.sumOf { it.owners.size }, producer != null)
}
