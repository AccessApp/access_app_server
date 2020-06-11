const moment = require('moment')
const nanoid = require('nanoid')
const Visitor = require('../models/visitor.model')
const Place = require('../models/place.model')
const PlaceType = require('../models/place.type.model')
const Slot = require('../models/slot.model')
const Booking = require('../models/booking.model')
const slotTypes = require('../enums/slot.type.enum')
const http = require('http')

const dateTimeFormat = 'DD.MM.YYYY HH:mm'
const dateFormat = 'DD.MM.YYYY'
const timeFormat = 'HH:mm'

exports.generateUserId = (req, res) => {
  let id = nanoid.nanoid()

  new Visitor({
    _id: id,
    priorityId: 0,
    favourites: []
  }).save()
    .then(() => {
      return res.status(200).send({ id })
    })
    .catch(err => {
      return res.status(500).send({ message: 'Could not save user!' })
    })
}

exports.getBookings = async (req, res) => {
  if (!req.params.visitorId) {
    return res.status(400).send({ message: 'Invalid User ID' })
  }

  let bookings = await Booking.find({ visitorId: req.params.visitorId }).populate({
    path: 'slotId',
    populate: { path: 'placeId' }
  })
  let output = []

  bookings.forEach(booking => {
    let o = output[moment(booking.slotId.starts).format(dateFormat)]
    if (o)
      o.push({
        name: booking.slotId.placeId.name,
        type: slotTypes.findById(booking.slotId.typeId).name,
        startTime: moment(booking.slotId.starts).format(timeFormat),
        endTime: moment(booking.slotId.ends).format(timeFormat),
        visitors: booking.slotId.friendsNumber,
        occupiedSlots: booking.slotId.occupiedSlots,
        maxSlots: booking.slotId.maxVisitors
      })
    else
      output[moment(booking.slotId.starts).format(dateFormat)] = [{
        name: booking.slotId.placeId.name,
        type: slotTypes.findById(booking.slotId.typeId).name,
        startTime: moment(booking.slotId.starts).format(timeFormat),
        endTime: moment(booking.slotId.ends).format(timeFormat),
        visitors: booking.slotId.friendsNumber,
        occupiedSlots: booking.slotId.occupiedSlots,
        maxSlots: booking.slotId.maxVisitors
      }]

  })

  return res.status(200).send({
    visits: {...output}
  })
}

exports.getPlaces = async (req, res) => {
  let favourites = []
  if (req.params.visitorId) {
    let visitor = await Visitor.findById(req.params.visitorId)
    if (visitor) favourites = visitor.favourites
  }
  let placeTypes = new Map()
  let types = await PlaceType.find()
  types.map(place => placeTypes.set(place._id, place.name))
  let places = await Place.find()
  let output = places.map(place => ({
    id: place._id,
    name: place.name,
    type: placeTypes.get(place.placeTypeId),
    image: place.image,
    description: place.description,
    www: place.url,
    location: place.coordinates,
    isFavourite: favourites.includes(place._id)
  }))

  return res.status(200).send({
    places: output
  })
}

exports.getPlaceSlots = async (req, res) => {
  if (!req.params.placeId) {
    return res.status(404).send({ message: 'Invalid Place ID' })
  }
  if (!req.params.visitorId) {
    return res.status(404).send({ message: 'Invalid Visitor ID' })
  }

  let slots = await Slot.find({
    placeId: req.params.placeId,
    // starts: { $gte: moment().startOf('day').toDate() }
  }).sort({ starts: 1 })

  let slotIds = slots.map(slot => (slot.id))

  let bookings = await Booking.find({ slotId: { $in: slotIds } })

  let output = []

  slots.forEach(slot => {
    let o = output[moment(slot.starts).format(dateFormat)]
    if (o) o.push({
      id: slot.id,
      type: slotTypes.findById(slot.typeId).name,
      from: moment(slot.starts).format(timeFormat),
      to: moment(slot.ends).format(timeFormat),
      occupiedSlots: slot.occupiedSlots,
      maxSlots: slot.maxVisitors,
      isPlanned: !!bookings.find(booking => booking.slotId === slot._id && booking.visitorId === req.params.visitorId)
    })
    else
      output[moment(slot.starts).format(dateFormat)] = [{
        id: slot.id,
        type: slotTypes.findById(slot.typeId).name,
        from: moment(slot.starts).format(timeFormat),
        to: moment(slot.ends).format(timeFormat),
        occupiedSlots: slot.occupiedSlots,
        maxSlots: slot.maxVisitors,
        isPlanned: !!bookings.find(booking => booking.slotId === slot._id && booking.visitorId === req.params.visitorId)
      }]
  })

  return res.status(200).send({
    slots: {...output}
  })
}

exports.changeFavourite = async (req, res) => {
  if (!req.params.visitorId)
    return res.status(400).send({ message: 'Invalid User ID' })

  if (!req.params.placeId)
    return res.status(400).send({ message: 'Invalid Place ID' })

  let visitor = await Visitor.findById(req.params.visitorId)

  if (!visitor)
    return res.status(400).send({ message: 'Invalid User ID' })

  if (visitor.favourites.includes(req.params.placeId)) {
    for (let i = 0; i < visitor.favourites.length; i++) {
      if (visitor.favourites[i] === req.params.placeId) {
        visitor.favourites.splice(i, 1)
        break
      }
    }
  } else visitor.favourites.push(req.params.placeId)

  await visitor.save()

  return res.status(204).send()
}

exports.visit = async (req, res) => {
  if (!req.params.visitorId || !req.body.slotId || !req.body.visitors) {
    return res.status(404).send({ message: 'Invalid data!' })
  }

  if (req.body.visitors > 7 || req.body.visitors < 1)
    return res.status(400).send({ message: 'Visitors must be between 1 and 7' })

  let slot = await Slot.findById(req.body.slotId)

  if (!slot) return res.status(404).send({ message: 'Slot not found' })

  let people = req.body.visitors

  let booking = await Booking.findOne({ slotId: req.body.slotId, visitorId: req.params.visitorId })

  if (booking) {
    people -= booking.friendsNumber
    if (people !== 0) {
      if (slot.occupiedSlots += people > slot.maxVisitors)
        return res.status(400).send({ message: 'Not enough place on this slot!' })

      booking.friendsNumber = req.body.visitors
      await booking.save()
    }

  } else {
    if (slot.occupiedSlots += people > slot.maxVisitors)
      return res.status(400).send({ message: 'Not enough place on this slot!' })

    new Booking({
      _id: nanoid.nanoid(),
      slotId: req.body.slotId,
      visitorId: req.params.visitorId,
      friendsNumber: people
    }).save()
  }

  slot.occupiedSlots += people
  await slot.save()

  return res.status(204).send()
}

exports.deleteVisit = async (req, res) => {
  if (!req.params.visitorId || !req.params.slotId) {
    return res.status(404).send({ message: 'Invalid data!' })
  }

  let found = await Booking.findOneAndDelete({ visitorId: req.params.visitorId, slotId: req.params.slotId })

  if (found) await Slot.findByIdAndUpdate(req.params.slotId,
    { $inc: { occupiedSlots: (found.friendsNumber * (-1)) } })

  return res.status(204).send()
}

exports.getPlaceTypes = async (req, res) => {
  let places = (await PlaceType.find()).map(place => ({ id: place._id, name: place.name }))
  return res.status(200).send({ placeTypes: places })
}

exports.addPlace = async (req, res) => {
  if (
    //todo save the user who created the place
    //!req.body.userId ||
    !req.body.name ||
    req.body.placeTypeId < 0 ||
    !req.body.imageBase64 ||
    !req.body.description ||
    !req.body.url ||
    !req.body.address ||
    !req.body.coordinates) {
    return res.status(400).send({ message: 'Missing body parameter!' })
  }
  placeTypeId = 0
  if (req.body.placeTypeId) placeTypeId = req.body.placeTypeId

  await new Place({
    _id: nanoid.nanoid(),
    name: req.body.name,
    placeTypeId: placeTypeId,
    image: req.body.imageBase64,
    description: req.body.description,
    url: req.body.url,
    address: req.body.address,
    coordinates: req.body.coordinates,
    // userId: req.body.userId
  }).save()

  return res.status(201).send()
}

const API_KEY = '0YYtJqHR65OgpxkPygHwMC557ykFw0gE'

exports.getCoordinates = async (req, res) => {
  if (
    //todo we don't want everyone to have access to the coordinate resolver
    // !req.body.userId ||
    !req.body.address) {
    return res.status(400).send({ message: 'Missing body params' })
  }

  const url = `http://www.mapquestapi.com/geocoding/v1/address?key=${API_KEY}&thumbMaps=false&maxResults=1&location=${req.body.address}`

  await http.get(url, (resp) => {
    let data = ''

    resp.on('data', (chunk) => {
      data += chunk
    })

    resp.on('end', () => {
      if (JSON.parse(data).results[0].locations.length > 0) {
        let loc = JSON.parse(data).results[0].locations[0].latLng
        return res.status(200).send({ coordinates: `${loc.lat},${loc.lng}` })
      }
      return res.status(404).send({ message: 'Location not found!' })
    })

  }).on('error', (err) => {
    return res.status(500).send({ message: 'Can\'t connect..' })
  })
}