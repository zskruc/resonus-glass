package com.facebook.react.jstasks
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import java.util.WeakHashMap
interface HeadlessJsTaskEventListener { fun onHeadlessJsTaskStart(taskId: Int); fun onHeadlessJsTaskFinish(taskId: Int) }
class HeadlessJsTaskConfig(val taskKey: String, val data: WritableMap, val timeout: Long, val foreground: Boolean)
class HeadlessJsTaskContext {
  private val listeners = mutableSetOf<HeadlessJsTaskEventListener>()
  private val active = mutableSetOf<Int>()
  private var serial = 0
  fun addTaskEventListener(listener: HeadlessJsTaskEventListener) { listeners.add(listener) }
  fun removeTaskEventListener(listener: HeadlessJsTaskEventListener) { listeners.remove(listener) }
  fun startTask(config: HeadlessJsTaskConfig): Int {
    val id = ++serial; active.add(id); listeners.toList().forEach { it.onHeadlessJsTaskStart(id) }; return id
  }
  fun finishTask(id: Int) { if (active.remove(id)) listeners.toList().forEach { it.onHeadlessJsTaskFinish(id) } }
  fun isTaskRunning(id: Int) = id in active
  fun hasActiveTasks() = active.isNotEmpty()
  fun finishAll() { active.toList().forEach(::finishTask) }
  companion object {
    private val instances = WeakHashMap<ReactContext, HeadlessJsTaskContext>()
    fun getInstance(context: ReactContext) = instances.getOrPut(context) { HeadlessJsTaskContext() }
  }
}
