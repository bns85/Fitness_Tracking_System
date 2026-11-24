const test = require("node:test");
const assert = require("node:assert/strict");
const Notification = require("../src/models/Notification");
const createNotificationController = require("../src/controllers/notificationController");
const workoutNotificationId = require("../src/utils/workoutNotificationId");

test("workout notifications have deterministic ObjectIds for retry safety", () => {
  const first = workoutNotificationId("user-1", "workout-1").toString();
  const retry = workoutNotificationId("user-1", "workout-1").toString();
  const otherWorkout = workoutNotificationId("user-1", "workout-2").toString();

  assert.match(first, /^[a-f0-9]{24}$/);
  assert.equal(first, retry);
  assert.notEqual(first, otherWorkout);
});

test("concurrent workout notification retries persist one notification", async () => {
  const originalFindById = Notification.findById;
  const originalCreate = Notification.create;
  let stored = null;
  let lookups = 0;
  let successfulCreates = 0;

  Notification.findById = async (id) => {
    if (lookups++ < 2) return null;
    return stored && stored._id.toString() === id.toString() ? stored : null;
  };
  Notification.create = async (body) => {
    if (stored) {
      const error = new Error("duplicate notification id");
      error.code = 11000;
      throw error;
    }
    successfulCreates += 1;
    stored = { ...body };
    return stored;
  };

  try {
    const controller = createNotificationController({ publish: async () => {} });
    const body = {
      userId: "user-1",
      workoutId: "workout-1",
      type: "WORKOUT_COMPLETED",
      title: "Workout completed",
      message: "Workout summary",
    };
    const invoke = async () => {
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(value) {
          this.value = value;
          return this;
        },
      };
      await controller.createFromGoal({ body, requestId: "request-1" }, res);
      return res;
    };

    const responses = await Promise.all([invoke(), invoke()]);

    assert.equal(successfulCreates, 1);
    assert.deepEqual(responses.map((response) => response.statusCode), [201, 201]);
    assert.equal(
      responses[0].value.notification._id.toString(),
      responses[1].value.notification._id.toString(),
    );
  } finally {
    Notification.findById = originalFindById;
    Notification.create = originalCreate;
  }
});
