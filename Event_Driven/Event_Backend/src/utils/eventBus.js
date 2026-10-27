const EventEmitter = require("events");

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  publish(eventName, data) {
    console.log(`[EVENT] ${eventName}:`, JSON.stringify(data).slice(0, 100));
    this.emit(eventName, data);
  }
}

const eventBus = new EventBus();

// Event types matching the architecture doc
const EVENTS = {
  STEP_UPDATED: "STEP_UPDATED",
  HEART_RATE_UPDATED: "HEART_RATE_UPDATED",
  DISTANCE_UPDATED: "DISTANCE_UPDATED",
  CALORIE_UPDATED: "CALORIE_UPDATED",
  SLEEP_RECORDED: "SLEEP_RECORDED",
  WEIGHT_LOGGED: "WEIGHT_LOGGED",
  FITNESS_DATA_INGESTED: "FITNESS_DATA_INGESTED",
  GOAL_REACHED: "GOAL_REACHED",
  NOTIFICATION_CREATED: "NOTIFICATION_CREATED",
  WORKOUT_STARTED: "WORKOUT_STARTED",
  WORKOUT_COMPLETED: "WORKOUT_COMPLETED",
  RECOMMENDATION_GENERATED: "RECOMMENDATION_GENERATED",
};

module.exports = { eventBus, EVENTS };
