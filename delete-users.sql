BEGIN;

DELETE FROM entitlements
WHERE user_id IN (
  SELECT id FROM users
  WHERE email IN (
    'trendzandendz@gmail.com',
    'jehmaris.mom@gmail.com',
    'nxtlvltechllc@gmail.com',
    'itsnxtlvlentertainmentllc@gmail.com',
    'jblazeisreal@gmail.com',
    'businesscart313@gmail.com'
  )
);

DELETE FROM users
WHERE email IN (
  'trendzzandendz@gmail.com',
  'jehmaris.mom@gmail.com',
  'nxtlvltechllc@gmail.com',
  'itsnxtlvlentertainmentllc@gmail.com',
  'jblazeisreal@gmail.com',
  'businesscart313@gmail.com'
);

COMMIT;
