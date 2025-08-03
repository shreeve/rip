import { faker } from '@faker-js/faker'
import { db, lawfirmsTable } from '../db/schema.ts'

router = new Hono

router.get '/', (c) ->
  firms = db.select().from(lawfirmsTable).all()
  c.json firms

router.post '/', async (c) ->
  name = faker.company.name()
  db.insert(lawfirmsTable).values({ name }).run()
  c.text "Law firm '#{name}' added"

export default router
